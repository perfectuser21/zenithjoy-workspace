import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {planFor} from '../wf-plan.mjs';
import {readFileSync} from 'node:fs';
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
  for(const s of ['preflight','cleanup'])assert.equal(r.activities.find(a=>a.key===s).from,'douyin_video_publish');
  for(const a of r.activities){
   assert.equal(a.owner.department,'新媒体部');
   for(const b of a.implementation_bindings||[])assert.ok(!b.path.includes('prep-prd')&&!b.path.includes('smoke-baseline'),'文档索引不得伪绑定code');
  }
 }
 assert.deepEqual(validateContracts(c),[]);
});
test('发布阶段探针只增加明确阶段，旧获客阶段保留',()=>{
 const s=JSON.parse(readFileSync(new URL('../../../services/phone-adb-controller/checks/schema.json',import.meta.url),'utf8'));
 for(const key of ['prepare','publish','verify','discovery','collection'])assert.ok(s.definitions.stage.enum.includes(key),key);
});
test('Codex合同不得变成获客执行计划，完整计划检查仍保原覆盖',()=>{
 const c=loadContractsFromDisk();
 for(const platform of keys){const k=platform+'_video_publish';assert.equal(c.contracts[k].execution_profile,'codex_agent');assert.equal(planFor(c,k,{allowMissing:true}).ok,false);}
 const r=spawnSync(process.execPath,['scripts/product-map/wf-plan.mjs','--check'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('发布能力有真正执行合同断言的node smoke而非静态空占位',()=>{
 const text=readFileSync(new URL('../../../.github/workflows/scripts/smoke/codex-publish-contract-smoke.sh',import.meta.url),'utf8');
 assert.match(text,/node --test/);assert.match(text,/publishing-contracts\.test\.js/);
});
test('手册配置和引用资源是skill组成，不冒充运行code',()=>{
 for(const d of Object.values(loadContractsFromDisk().contracts))for(const a of d.activities.filter(a=>!a.ref))for(const b of a.implementation_bindings||[]){
  if(b.path.startsWith('.agents/skills/')&&!b.path.includes('/scripts/'))assert.equal(b.kind,'skill',b.path);
 }
});
test('当前来源全集仅21安卓和公众号API，七个补入口保真实证据及非严格声明',()=>{
 const d=JSON.parse(readFileSync(new URL('../../../product-map/publishing/native-source-bindings.json',import.meta.url),'utf8'));
 assert.equal(d.branches.length,22);assert.equal(new Set(d.branches.map(b=>b.branch)).size,22);
 assert.equal(d.branches.filter(b=>b.channel==='android_rpa').length,21);
 assert.equal(d.branches.filter(b=>b.channel==='wechat_api').length,1);
 const extra=['xiaohongshu.image.phone','xiaohongshu.article.phone','toutiao.article.phone','weibo.article.phone','zhihu.idea.phone','zhihu.video.phone','zhihu.article.phone'];
 for(const key of extra){const b=d.branches.find(b=>b.branch===key);assert.ok(b,key);assert.match(b.skill_source_ref,/android-additional-modes\.md$/);assert.ok(b.evidence.length>0,key);for(const e of b.evidence)assert.match(e.sha256,/^[a-f0-9]{64}$/);}
 for(const b of d.branches){assert.equal(b.strict_all_guards_pass,'not_asserted');assert.equal(b.root_confirmed_effect,true);if(b.channel==='wechat_api')assert.equal(b.existing_platform_video_workflow_id,null);else assert.equal(b.capability_id,'24987ee5-53a0-4c37-946f-1b749954cac7');}
});
