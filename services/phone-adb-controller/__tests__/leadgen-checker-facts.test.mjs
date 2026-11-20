import test from'node:test';import assert from'node:assert/strict';
import {readFacts}from'../leadgen-foundation/checker-facts.mjs';
const context={assigned_workflow:'102',line:'fixture-line',company_id:'fixture-company',tenant_id:'fixture-tenant',tasks:{102:{task_id:'task',run_id:'run',run_tag:'run'}},verification:{102:{video_ids:['7709208240869657011']}}};
const request=(operation,args={})=>({identity:{task_id:'task',run_id:'run'},nonce:'fixture-nonce',context,operation,args});
function database(rows=[]){const calls=[];return{calls,readAuthority:async()=>context,loadPool:async()=>({connect:async()=>({query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.includes('current_database()')?[{database:'fixture',schema:'public',role:'readonly',transaction_read_only:'on',snapshot_at:'fixture'}]:sql.startsWith('SELECT')?rows:[]};},release(){calls.push({release:true});}}),end:async()=>calls.push({end:true})})};}
test('raw scoped PG rows are returned without business verdict or changed-state filtering',async()=>{
 const rows=[{video_id:'7709208240869657011',judgment_status:'rejected',process_status:'unexpected',transcript:null}],db=database(rows);
 const out=await readFacts(request('pg.rows',{relation:'videos'}),db);
 assert.equal(out.status,'available');assert.deepEqual(out.facts.rows,rows);assert.equal(out.verified,undefined);assert.equal(out.outcome,undefined);assert.equal(out.checks,undefined);
 assert.equal(db.calls[0].sql,'BEGIN READ ONLY');assert.ok(db.calls.some(x=>x.sql==='ROLLBACK'));
 const q=db.calls.find(x=>x.sql?.includes('FROM zenithjoy.leadgen_videos'));assert.ok(q.args.includes('fixture-line'));assert.match(q.sql,/video_id=ANY/);assert.doesNotMatch(q.sql,/judgment_status\s*=/);
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
test('qualification origin uses bound PG identity rather than caller supplied run or path',async()=>{
 const db=database([{video_id:'7709208240869657011',judgment_config:{run_id:'22222222-2222-4222-8222-222222222222'}}]),calls=[];
 db.originRead=async(c,run,video)=>{calls.push({c,run,video});return{origin:{run_id:run,video_id:video},visual_evidence_read:false};};
 const out=await readFacts(request('qualification.origin',{video_id:'7709208240869657011'}),db);assert.equal(out.status,'available');assert.equal(calls.length,1);assert.equal(calls[0].run,'22222222-2222-4222-8222-222222222222');
 for(const args of [{video_id:'foreign'},{video_id:'7709208240869657011',run_id:'forged'},{video_id:'7709208240869657011',path:'/tmp/forged'}])assert.equal((await readFacts(request('qualification.origin',args),db)).status,'unavailable');assert.equal(calls.length,1);
});
test('qualification origin projects the original ASR response without including its full recognition body',async()=>{
 const videoId='7709208240869657011',runId='22222222-2222-4222-8222-222222222222';
 const db=database([{video_id:videoId,judgment_config:{run_id:runId}}]);
 const document={sha256:'fixture-response',data:{http_status:200,body:{output:{text:'recognized',sentence:['verbose']}}}};
 db.originRead=async(_context,run,video)=>({origin:{run_id:run,video_id:video},documents:{'asr-response.json':document}});
 const args={video_id:videoId,document:'asr-response.json',fields:['origin.run_id','document.sha256','document.data.http_status','document.data.body.output.text']};
 const out=await readFacts(request('qualification.origin',args),db);
 assert.equal(out.status,'available');
 assert.deepEqual(out.facts,{origin:{run_id:runId},document:{sha256:document.sha256,data:{http_status:200,body:{output:{text:'recognized'}}}}});
 const full=await readFacts(request('qualification.origin',{video_id:videoId}),db);
 assert.deepEqual(full.facts.documents['asr-response.json'],document);
 for(const document of ['../asr-response.json','unregistered.json',null]){
  const calls=db.calls.length;
  assert.equal((await readFacts(request('qualification.origin',{...args,document}),db)).status,'unavailable');
  assert.equal(db.calls.length,calls);
 }
});
test('media metadata names are bounded to this run and cannot launch caller commands',async()=>{
 const calls=[],deps={readAuthority:async()=>context,mediaRead:async(c,name)=>{calls.push(name);return{metadata:{streams:[]}};}};
 assert.equal((await readFacts(request('media.inspect',{name:'run-v7709208240869657011.wav'}),deps)).status,'available');
 for(const args of [{name:'foreign.wav'},{name:'run/../clip.wav'},{name:'run-clip.wav',command:'arbitrary'}])assert.equal((await readFacts(request('media.inspect',args),deps)).status,'unavailable');assert.equal(calls.length,1);
});


test('current run progress exposes activity starts and terminal status without model usage or verdicts',async()=>{
 const identity={task_id:'task',run_id:'run'};
 const deps={readAuthority:async()=>context,readLedger:async bound=>{
  assert.deepEqual(bound,identity);
  return {identity,calls:[{role:'checker',activity_key:'preflight',status:'completed'},
   {role:'activity',activity_key:'cleanup',action_id:'action',status:'prepared',dispatch_status:'unknown',started_at_ms:123,usage:{internal:42}}],
   attempts:[],observations:[{activity_key:'preflight',kind:'checker',phase:'start',status:'blocked',started_at_ms:100}]};
 }};
 const answer=await readFacts(request('run.progress'),deps);
 assert.equal(answer.status,'available');
 assert.deepEqual(answer.facts.activity_calls,[{activity_key:'cleanup',action_id:'action',status:'prepared',dispatch_status:'unknown',started_at_ms:123}]);
 assert.equal(answer.facts.observations[0].activity_key,'preflight');
 assert.doesNotMatch(JSON.stringify(answer),/usage|internal|verdict/);
 const bad={...deps,readLedger:async()=>({identity:{task_id:'foreign',run_id:'run'},calls:[],attempts:[],observations:[]})};
 assert.equal((await readFacts(request('run.progress'),bad)).status,'unavailable');
 assert.equal((await readFacts(request('run.progress',{run_id:'foreign'}),deps)).status,'unavailable');
});

test('run identity proves the same independently persisted Foundation Run without forwarding its full payload',async()=>{
 const identity={task_id:'task',run_id:'run'}, calls=[];
 const assigned={...identity,input:{run_tag:'run'},definition:{workflow_id:'workflow',release_id:'release',workflow_definition_version_id:'definition'},
  run:{...identity,input:{run_tag:'run'}},runtime:{command_secret:'not-for-the-checker'}};
 const deps={readAuthority:async()=>context,brainGet:async endpoint=>{
  calls.push(endpoint);
  return {task:{id:'task',status:'in_progress',payload:{private_configuration:'must-not-forward'},result:{foundation_runner:assigned}}};
 }};
 const receipt=await readFacts(request('run.identity'),deps);
 assert.equal(receipt.status,'available');
 assert.deepEqual(receipt.facts,{...identity,run_tag:'run',task_status:'in_progress',workflow_id:'workflow',release_id:'release',workflow_definition_version_id:'definition'});
 assert.deepEqual(calls,['/tasks/task']);
 assert.equal((await readFacts(request('run.identity',{task_id:'foreign'}),deps)).status,'unavailable');
 assert.equal(calls.length,1);
 assigned.run.run_id='foreign';
 assert.equal((await readFacts(request('run.identity'),deps)).status,'unavailable');
});

test('the frozen receipt inventory keeps a real source path and unknown action without exposing arguments',async()=>{
 const {listHostReceipts}=await import('../leadgen-foundation/checker-facts-runtime.mjs');
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,symlinkSync}=await import('node:fs');
 const {join}=await import('node:path'), {tmpdir}=await import('node:os');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'checker-receipts-'))), directory=join(root,'receipts');
 try{
  mkdirSync(directory,{mode:0o700});
  const identity={task_id:'task',run_id:'run',run_tag:'run'};
  const create=(name,target=identity)=>writeFileSync(join(directory,name),JSON.stringify({binding:{identity:target,activity:'preflight',kind:'phone',
   args:['account-current','sensitive-argument']},state:'unknown',started_at:123.45,result:null}),{mode:0o600});
  create('account-current.json');
  writeFileSync(join(directory,'cv-filters-original.json'),JSON.stringify({args:['search-time-layer'],exit_code:0,stdout:'live evidence',stderr:''}),{mode:0o644});
  writeFileSync(join(directory,'cv-video-handoff.json'),JSON.stringify([{video_id:'1234567890123456',author:'原作者'}]),{mode:0o644});
  const items=listHostReceipts(root,identity);
  assert.deepEqual(items,[{path:'receipts/account-current.json',activity:'preflight',kind:'phone',operation:'account-current',state:'unknown',started_at:123.45}]);
  create('foreign.json',{...identity,run_id:'foreign'});
  assert.throws(()=>listHostReceipts(root,identity),/FACT_RUNTIME_UNAVAILABLE/);
  rmSync(join(directory,'foreign.json'));
  symlinkSync(join(directory,'account-current.json'),join(directory,'alias.json'));
  assert.throws(()=>listHostReceipts(root,identity),/FACT_RUNTIME_UNAVAILABLE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('fact selection retains exact PG row values and drops unrelated large fields', async () => {
  const rows = [{video_id:'first', updated_at:'2026-11-20T08:10:00Z', transcript:null, discovery_metrics:'x'.repeat(100000)},
    {video_id:'second', updated_at:'2026-11-20T08:11:00Z', transcript:'words', discovery_metrics:'y'.repeat(100000)}];
  const db = database(rows);
  const out = await readFacts(request('pg.rows', {relation:'videos', fields:['rows.video_id','rows.updated_at','rows.transcript','rows.discovery_metrics.another_field','connection.transaction_read_only']}), db);
  assert.equal(out.status, 'available');
  assert.deepEqual(out.facts, {connection:{transaction_read_only:'on'}, rows:rows.map(({video_id,updated_at,transcript})=>({video_id,updated_at,transcript}))});
  assert.equal(db.calls[0].sql, 'BEGIN READ ONLY');
  assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));
});

test('fact selection retains nested approved task input without returning the contract blob', async () => {
  const input = {business:{scope:{video_ids:['a']}}};
  const deps = {readAuthority:async()=>context, brainGet:async()=>({task:{id:'task', result:{foundation_runner:{run:{input, contract:'x'.repeat(100000)}}}}})};
  const out = await readFacts(request('brain.get', {resource:'task',fields:['task.id','task.result.foundation_runner.run.input']}), deps);
  assert.deepEqual(out.facts, {task:{id:'task',result:{foundation_runner:{run:{input}}}}});
});

test('invalid field selectors and foreign authority do not reach a source', async () => {
  const db = database();
  for(const fields of [[], 'rows', ['rows.__proto__.secret'], ['rows.constructor.name'], ['rows.*'], ['rows[0].video_id']]) {
    assert.equal((await readFacts(request('pg.rows',{relation:'videos',fields}),db)).status,'unavailable');
  }
  assert.equal((await readFacts({...request('pg.rows',{relation:'videos',fields:['rows.video_id']}),identity:{task_id:'foreign',run_id:'run'}},db)).status,'unavailable');
  assert.deepEqual(db.calls,[]);
});
