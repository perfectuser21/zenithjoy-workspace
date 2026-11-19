import test from'node:test';import assert from'node:assert/strict';
import {readFacts}from'../leadgen-foundation/checker-facts.mjs';
const context={assigned_workflow:'102',line:'fixture-line',company_id:'fixture-company',tenant_id:'fixture-tenant',tasks:{102:{task_id:'task',run_id:'run',run_tag:'run'}},verification:{102:{video_ids:['7709208240869657011']}}};
const request=(operation,args={})=>({identity:{task_id:'task',run_id:'run'},nonce:'fixture-nonce',context,operation,args});
function database(rows=[]){const calls=[];return{calls,loadPool:async()=>({connect:async()=>({query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.startsWith('SELECT')?rows:[]};},release(){calls.push({release:true});}}),end:async()=>calls.push({end:true})})};}
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
 const calls=[];const deps={brainGet:async(endpoint)=>{calls.push(endpoint);return{task:{status:'failed'}};}};
 assert.equal((await readFacts(request('brain.get',{resource:'task'}),deps)).facts.task.status,'failed');assert.deepEqual(calls,['/tasks/task']);
 const bad=await readFacts(request('brain.get',{resource:'task',task_id:'foreign'}),deps);assert.equal(bad.status,'unavailable');assert.equal(calls.length,1);
});
test('native and CRM providers cannot be used to navigate, send or nominate an arbitrary URL',async()=>{
 const calls=[],deps={nativeRead:async()=>{calls.push('native');return{foreground_package:'fixture',local_lock:{lock:'held'}};},feishuGet:async()=>{calls.push('crm');return{};}};
 assert.equal((await readFacts(request('native.read'),deps)).status,'available');
 for(const r of [request('native.read',{command:'tap'}),request('feishu.get',{url:'https://attacker.invalid'}),request('feishu.get',{record_id:'arbitrary'})])assert.equal((await readFacts(r,deps)).status,'unavailable');
 assert.deepEqual(calls,['native']);
});
