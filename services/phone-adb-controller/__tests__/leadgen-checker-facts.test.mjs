import test from'node:test';import assert from'node:assert/strict';
import {readFacts}from'../leadgen-foundation/checker-facts.mjs';
const context={assigned_workflow:'102',line:'fixture-line',company_id:'fixture-company',tenant_id:'fixture-tenant',tasks:{102:{task_id:'task',run_id:'run',run_tag:'run'}},verification:{102:{video_ids:['7709208240869657011']}}};
const request=(operation,args={})=>({identity:{task_id:'task',run_id:'run'},nonce:'fixture-nonce',context,operation,args});
function database(rows=[]){const calls=[];return{calls,readAuthority:async()=>context,loadPool:async()=>({connect:async()=>({query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.startsWith('SELECT')?rows:[]};},release(){calls.push({release:true});}}),end:async()=>calls.push({end:true})})};}
test('raw scoped PG rows are returned without business verdict or changed-state filtering',async()=>{
 const rows=[{video_id:'7709208240869657011',judgment_status:'rejected',process_status:'unexpected',transcript:null}],db=database(rows);
 const out=await readFacts(request('pg.rows',{relation:'videos'}),db);
 assert.equal(out.status,'available');assert.deepEqual(out.facts.rows,rows);assert.equal(out.verified,undefined);assert.equal(out.outcome,undefined);assert.equal(out.checks,undefined);
 assert.equal(db.calls[0].sql,'BEGIN READ ONLY');assert.ok(db.calls.some(x=>x.sql==='ROLLBACK'));
 const q=db.calls.find(x=>x.sql?.startsWith('SELECT'));assert.ok(q.args.includes('fixture-line'));assert.match(q.sql,/video_id=ANY/);assert.doesNotMatch(q.sql,/judgment_status\s*=/);
});
test('unknown operation, arbitrary SQL, foreign IDs and different task identity never open a connection',async()=>{
 for(const r of [request('pg.write'),request('pg.rows',{relation:'videos',sql:'DELETE FROM anything'}),request('pg.rows',{relation:'videos',ids:['other']}),{...request('pg.rows',{relation:'videos'}),identity:{task_id:'foreign',run_id:'run'}}]){
  const db=database();const out=await readFacts(r,db);assert.equal(out.status,'unavailable');assert.equal(db.calls.length,0);assert.equal(out.facts,null);
 }
});
test('scope uses parameters and database errors cannot become passed or leak connection details',async()=>{
 const db=database();db.loadPool=async()=>({connect:async()=>({query:async(sql)=>{db.calls.push(sql);if(sql.startsWith('SELECT'))throw Error('postgres://secret@example/db');return{rows:[]};},release(){}}),end:async()=>{}});
 const out=await readFacts(request('pg.rows',{relation:'comments'}),db);assert.equal(out.status,'unavailable');assert.equal(out.reason,'FACT_READ_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(out),/secret|example/);assert.ok(db.calls.includes('ROLLBACK'));
});
test('provider only performs bound Brain GET and returns missing records as facts, not a business failure',async()=>{
 const calls=[];const deps={readAuthority:async()=>context,brainGet:async(endpoint)=>{calls.push(endpoint);return{task:{status:'failed'}};}};
 assert.equal((await readFacts(request('brain.get',{resource:'task'}),deps)).facts.task.status,'failed');assert.deepEqual(calls,['/tasks/task']);
 const bad=await readFacts(request('brain.get',{resource:'task',task_id:'foreign'}),deps);assert.equal(bad.status,'unavailable');assert.equal(calls.length,1);
});
test('native and CRM providers cannot be used to navigate, send or nominate an arbitrary URL',async()=>{
 const calls=[],deps={readAuthority:async()=>context,nativeRead:async()=>{calls.push('native');return{foreground_package:'fixture',local_lock:{lock:'held'}};},feishuGet:async()=>{calls.push('crm');return{};}};
 assert.equal((await readFacts(request('native.read'),deps)).status,'available');
 for(const r of [request('native.read',{command:'tap'}),request('feishu.get',{url:'https://attacker.invalid'}),request('feishu.get',{record_id:'arbitrary'})])assert.equal((await readFacts(r,deps)).status,'unavailable');
 assert.deepEqual(calls,['native']);
});
test('the CRM transport only permits fixed-origin GET and the fixed authentication endpoint',async()=>{
 const {readOnlyCrmFetch}=await import('../leadgen-foundation/checker-facts-runtime.mjs');
 for(const [url,method]of [['https://attacker.invalid/open-apis/records','GET'],['https://open.feishu.cn/open-apis/records','POST'],['https://open.feishu.cn/open-apis/records','DELETE'],['https://user:pass@open.feishu.cn/open-apis/records','GET']])assert.throws(()=>readOnlyCrmFetch(url,{method}),/FACT_RUNTIME_UNAVAILABLE/);
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true};};
 try{await readOnlyCrmFetch('https://open.feishu.cn/open-apis/bitable/v1/apps/f/tables/t/records/r');assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.signal);}finally{globalThis.fetch=old;}
});

test('authority is required and merged output cannot replace frozen tenant, scope or credential paths',async()=>{
 for(const changed of [{line:'foreign'},{credentials:{database:'/tmp/attacker'}},{runtime_root:'/tmp/attacker'},{verification:{102:{video_ids:['foreign']}}},{input_provenance:{producer:{task_id:'foreign'}}}]){
  const db=database();const r={...request('pg.rows',{relation:'videos'}),context:{...context,...changed}};
  const out=await readFacts(r,db);assert.equal(out.status,'unavailable');assert.equal(db.calls.length,0);
 }
 const db=database();delete db.readAuthority;assert.equal((await readFacts(request('pg.rows',{relation:'videos'}),db)).status,'unavailable');assert.equal(db.calls.length,0);
});

test('103 bound comments resolve original video facts without eligibility filters',async()=>{
 const db=database([{transcript:'original words'}]);const c={...context,assigned_workflow:'103',tasks:{103:context.tasks[102]},verification:{103:{comment_ids:['00000000-0000-4000-8000-000000000001']}}};db.readAuthority=async()=>c;
 const out=await readFacts({...request('pg.rows',{relation:'videos'}),context:c},db);
 assert.equal(out.status,'available');const q=db.calls.find(x=>x.sql?.includes('FROM zenithjoy.leadgen_videos'));assert.match(q.sql,/leadgen_comments/);assert.match(q.sql,/source_video_url/);assert.ok(q.args.some(x=>Array.isArray(x)&&x.includes(c.verification[103].comment_ids[0])));assert.doesNotMatch(q.sql,/judgment_status\s*=/);
});
test('current company configuration remains visible before a run snapshot exists',async()=>{
 const db=database([{config_status:'disabled',config_version:34}]);
 const out=await readFacts(request('pg.rows',{relation:'company'}),db);assert.equal(out.status,'available');assert.equal(out.facts.rows[0].config_status,'disabled');
 const q=db.calls.find(x=>x.sql?.includes('tenant_company_profiles'));assert.deepEqual(q.args,['fixture-company','fixture-tenant']);assert.doesNotMatch(q.sql,/config_status\s*=/);
});
test('PG evidence records actual connection identity and transaction read-only state',async()=>{
 const db=database();const out=await readFacts(request('pg.rows',{relation:'videos'}),db);
 assert.ok(db.calls.some(x=>x.sql?.includes('current_database()')&&x.sql.includes('transaction_read_only')));assert.ok(Object.hasOwn(out.facts,'connection'));
});
