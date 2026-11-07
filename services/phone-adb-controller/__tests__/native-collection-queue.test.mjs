import test from 'node:test';import assert from 'node:assert/strict';
import {usingNativeCollectionQueue as fixture} from './fixtures/native-collection-queue-fixture.mjs';
async function domain(t,f,extra={}){const dependencies=await f.makeDependencies();t.after(()=>dependencies.close());const options={...f,dependencies,qualificationRecords:f.qualificationRecords,directory:f.makeDirectory('collection-queue'),assertAuthority:f.authority(),...extra},q=f.api.createNativeCollectionQueue(options);t.after(()=>q.close());return {q,dependencies,options};}
test('original native rows persist through owned real PG and independent Judge re-reads native files and actual PG',async t=>fixture(t,async f=>{
 const {q,dependencies}=await domain(t,f),{cap}=await f.makeCapture();
 assert.equal((await q.prepare()).video_ids[0],f.vid);assert.equal((await q.history(f.vid)).rows.length,0);
 const result=await q.collect(f.vid,cap);assert.equal(result.inserted,1);assert.equal(result.comments,1);assert.equal((await q.readback(f.vid)).coverage,1);
 assert.equal((await f.read()).find(v=>v.video_id===f.vid).process_status,'评论已采');
 const stopped=await q.close();assert.equal(q.verifyStopped(stopped),true);assert.equal(q.verifyStopped({...stopped}),false);const packet=q.issuedReceipts();assert.equal((await dependencies.close()).execution_stopped,true);
 const judge=await f.makeDependencies();try{const proof=await f.api.readNativeCollectionQueueReceipts(packet,{...f,scope:f.scope,dependencies:judge,directory:f.makeDirectory('collection-judge'),assertAuthority:f.authority()});assert.equal(proof.verified,true);assert.equal(proof.coverage,1);assert.equal(proof.eligible,1);assert.equal(proof.partial,false);assert.equal(proof.empty,0);assert.throws(()=>f.api.createNativeCollectionQueue({...f,dependencies:{...judge},qualificationRecords:f.qualificationRecords,directory:f.makeDirectory('forged'),assertAuthority:f.authority()}),/UNBRANDED/);}finally{await judge.close();}
}));
test('serialized qualification or capture never allocates a PG writer',async t=>fixture(t,async f=>{
 const {q}=await domain(t,f,{qualificationRecords:{...f.qualificationRecords}}),before=f.allocated();await assert.rejects(q.prepare(),/HANDOFF_UNBRANDED/);assert.equal(f.allocated(),before);
 const own=await domain(t,f),{cap}=await f.makeCapture();await own.q.prepare();const beforeWrite=f.calls.filter(x=>x.startsWith('INSERT INTO zenithjoy.leadgen_comments')).length;await assert.rejects(own.q.collect(f.vid,{...cap}),/CAPTURE_BRAND/);assert.equal(f.calls.filter(x=>x.startsWith('INSERT INTO zenithjoy.leadgen_comments')).length,beforeWrite);
}));
test('confirmed native zero performs no original collect or comment INSERT and preserves processing lease for cleanup',async t=>fixture(t,async f=>{
 const {q}=await domain(t,f),{cap}=await f.makeCapture({zero:true}),writes=f.calls.filter(x=>/^\s*(?:INSERT|UPDATE)/.test(x)).length,result=await q.collect(f.vid,cap);assert.equal(result.queued,false);assert.equal(result.status,'empty');assert.equal(f.calls.filter(x=>/^\s*(?:INSERT|UPDATE)/.test(x)).length,writes);assert.equal((await f.read()).find(v=>v.video_id===f.vid).process_status,'处理中:'+f.scope.run);
}));
test('actual collection COMMIT ACK loss permits exact readback but never resends the capture',async t=>fixture(t,async f=>{
 const {q}=await domain(t,f),{cap}=await f.makeCapture();f.loseCommit();await assert.rejects(q.collect(f.vid,cap),/COMMIT_UNKNOWN/);assert.equal(q.snapshot().external_effect,'unknown');const inserted=f.calls.filter(x=>x.includes('INSERT INTO zenithjoy.leadgen_comments')).length;
 const actual=await q.readback(f.vid);assert.equal(actual.coverage,1);await assert.rejects(q.collect(f.vid,cap),/WRITE_ALREADY_ISSUED|COMMIT_UNKNOWN/);assert.equal(f.calls.filter(x=>x.includes('INSERT INTO zenithjoy.leadgen_comments')).length,inserted);await q.close();assert.throws(()=>q.issuedReceipts(),/RECEIPTS_UNKNOWN/);
 const next=await domain(t,f);await assert.rejects(next.q.collect(f.vid,cap),/WRITE_ALREADY_ISSUED|VIDEO_DRIFT/);assert.equal(f.calls.filter(x=>x.includes('INSERT INTO zenithjoy.leadgen_comments')).length,inserted);
}));
test('ordinary partial capture rechecks an existing row without changing its original ID, owner or collected time',async t=>fixture(t,async f=>{
 const db=(await f.load('leadgen-db-lib.js')).default,url='https://www.douyin.com/video/'+f.vid;
 await f.db(c=>db.upsertComment(c,{lineKey:'yuesheng',harvestBatch:'older_fixture',nickname:'测试评论人',douyinId:'fixture-account-102',commentBody:'测试完整评论 首评',sourceVideoUrl:url}));
 const before=await f.db(async c=>(await c.query('SELECT id,harvest_batch,collected_at FROM zenithjoy.leadgen_comments')).rows[0]),{q}=await domain(t,f),{cap}=await f.makeCapture({partial:true});
 assert.equal((await q.history(f.vid)).rows.length,1);const result=await q.collect(f.vid,cap);assert.equal(result.inserted,0);assert.equal(result.coverage,1);assert.equal(result.status,'partial');assert.equal((await q.readback(f.vid)).coverage,1);
 assert.deepEqual(await f.db(async c=>(await c.query('SELECT id,harvest_batch,collected_at FROM zenithjoy.leadgen_comments')).rows[0]),before);assert.equal((await f.read()).find(v=>v.video_id===f.vid).process_status,'处理中:'+f.scope.run);
}));
test('independent Judge rejects actual PG drift despite the worker receipt and native XML remaining valid',async t=>fixture(t,async f=>{
 const {q,dependencies}=await domain(t,f),{cap}=await f.makeCapture();await q.collect(f.vid,cap);await q.readback(f.vid);await q.close();const packet=q.issuedReceipts();await dependencies.close();
 await f.db(c=>c.query('UPDATE zenithjoy.leadgen_comments SET comment_body=$1',['drifted actual PG row']));const judge=await f.makeDependencies();try{await assert.rejects(f.api.readNativeCollectionQueueReceipts(packet,{...f,dependencies:judge,directory:f.makeDirectory('drift-judge'),assertAuthority:f.authority()}),/RPC_SAMPLE_IDENTITY_NOT_UNIQUE|READBACK/);}finally{await judge.close();}
}));
