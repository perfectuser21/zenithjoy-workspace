import test from 'node:test';import assert from 'node:assert/strict';
import {usingNativeCollectionQueue as fixture} from './fixtures/native-collection-queue-fixture.mjs';
test('Code collection renewal uses original leased-VID op and fresh history proof reads actual PG',async t=>fixture(t,async f=>{
 const dependencies=await f.makeDependencies(),q=f.api.createNativeCollectionQueue({...f,dependencies,qualificationRecords:f.qualificationRecords,directory:f.makeDirectory('renew-history'),assertAuthority:f.authority()});try{
  const renewal=await q.renew(f.vid);assert.equal(renewal.renewed,true);assert.equal((await f.read()).find(v=>v.video_id===f.vid).process_status,'处理中:'+f.scope.run);
  const before=f.calls.filter(x=>/^\s*(INSERT|UPDATE)/.test(x)).length,history=await q.historyReadback(f.vid);assert.equal(history.verified,true);assert.equal(history.history_verified,0);assert.deepEqual(history.ids,[]);assert.deepEqual(history.consumed_history,[]);assert.equal(f.calls.filter(x=>/^\s*(INSERT|UPDATE)/.test(x)).length,before);assert.ok(f.calls.some(x=>x==='BEGIN READ ONLY'));
  await assert.rejects(q.renew(f.other),/TARGET/);const readonly=f.api.createNativeCollectionQueue({...f,dependencies,qualificationRecords:f.qualificationRecords,directory:f.makeDirectory('readonly-renew'),assertAuthority:f.authority(),readOnly:true,deadlineMs:f.scope.receipt_deadline_ms-1}),allocated=f.allocated();await assert.rejects(readonly.renew(f.vid),/READONLY/);assert.equal(f.allocated(),allocated);await readonly.close();
 }finally{await q.close();await dependencies.close();}
}));
