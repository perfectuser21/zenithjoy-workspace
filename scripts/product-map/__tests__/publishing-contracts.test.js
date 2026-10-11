import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadContractsFromDisk,validateContracts,assemble} from '../contracts-lib.mjs';
const keys=['bilibili','douyin','kuaishou','toutiao','wechat_channels','weibo','xiaohongshu','zhihu'];
test('既有发布workflow点号身份必须原样接受，禁止偷换稳定key',()=>{
 const c=loadContractsFromDisk();c.contracts.douyin_video_discovery.brain_workflow_key='douyin_video_publish.android';
 assert.deepEqual(validateContracts(c),[]);
});
test('workflow身份仍拒绝路径和空白',()=>{
 for(const key of ['douyin/android','douyin android','../android']){
  const c=loadContractsFromDisk();c.contracts.douyin_video_discovery.brain_workflow_key=key;
  assert.ok(validateContracts(c).some(e=>e.includes('brain_workflow_key')));
 }
});
test('八个现有发布流程加厚同一真实能力，共享预检收尾且无获客来源',()=>{
 const c=loadContractsFromDisk();
 for(const platform of keys){
  const key=platform+'_video_publish',d=c.contracts[key];assert.ok(d, key+'缺契约');
  assert.equal(d.capability,'android_worker_publish');assert.equal(d.brain_workflow_key,key+'.android');
  assert.equal(d.source_repo,'perfectuser21/zenithjoy-workspace');
  const r=assemble(c,key);assert.equal(r.ok,true,r.errors.join('\n'));
  assert.deepEqual(r.activities.map(a=>a.key),['preflight','prepare','publish','verify','cleanup']);
  for(const s of ['preflight','cleanup'])assert.equal(r.activities.find(a=>a.key===s).from,'publish_common');
  for(const a of r.activities){
   assert.equal(a.owner.department,'新媒体部');
   for(const b of a.implementation_bindings||[])assert.ok(!b.path.includes('prep-prd')&&!b.path.includes('smoke-baseline'),'文档索引不得伪绑定code');
  }
 }
 assert.deepEqual(validateContracts(c),[]);
});
