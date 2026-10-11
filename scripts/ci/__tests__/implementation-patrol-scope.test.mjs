import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';

const contractPath='scripts/phone-account-patrol/implementation-contract.json';
const sourceContract=JSON.parse(readFileSync(new URL('../../../'+contractPath,import.meta.url)));
const caller=()=>YAML.parse(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
const api=()=>import('../implementation-patrol-scope.mjs');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'patrol-scope-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:root,encoding:'utf8'}).trim();
 git('init','-q','-b','main');git('config','user.name','scope-fixture');git('config','user.email','scope@example.invalid');git('remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s)};
 put(contractPath,JSON.stringify(sourceContract));for(const p of [...sourceContract.workflows.flatMap(w=>w.activities.flatMap(a=>a.bindings)),...sourceContract.auxiliary_paths])if(p!==contractPath)put(p,'fixture\n');
 const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD')};
 const base=commit();return {root,git,put,commit,base,registeredRevision:base,contract:structuredClone(sourceContract)};
}
async function classify(f){return (await api()).classifyPatrolDiff({repoRoot:f.root,base:f.base,head:f.commit(),registeredRevision:f.registeredRevision})}
test('真实纯获客diff明确not_applicable且没有PASS receipt',async t=>{
 const f=fixture(t);f.put('services/phone-adb-controller/douyin-phone-adb','leadgen\n');const r=await classify(f);
 assert.equal(r.classification,'not_applicable');assert.equal(r.scope,'cecelia-device-patrol');assert.equal(r.verdict,undefined);assert.equal(r.receipt,undefined);assert.deepEqual(r.changed_files,['services/phone-adb-controller/douyin-phone-adb']);
});
test('真实巡查与混合diff必须applicable且完整保留无关路径',async t=>{
 const f=fixture(t),p=f.contract.workflows[0].activities[0].bindings[0];f.put(p,'changed\n');f.put('services/phone-adb-controller/new.mjs','unclaimed\n');const r=await classify(f);
 assert.equal(r.classification,'applicable');assert.deepEqual(r.changed_files,[p,'services/phone-adb-controller/new.mjs'].sort());assert.ok(r.patrol_paths.includes(p));
});
test('删除旧binding并从候选合同移除仍触发；原差异不切片',async t=>{
 const f=fixture(t),p=f.contract.workflows[0].activities[0].bindings.pop();rmSync(join(f.root,p));f.put(contractPath,JSON.stringify(f.contract));const r=await classify(f);
 assert.equal(r.classification,'applicable');assert.ok(r.patrol_paths.includes(p));assert.ok(r.changed_files.includes(contractPath));
});
test('重命名注册文件及专属CI删除仍触发',async t=>{
 const f=fixture(t),p=f.contract.workflows[0].activities[0].bindings[0];f.git('mv',p,p+'.moved');f.put('.github/workflows/phone-account-patrol.yml','changed');const r=await classify(f);
 assert.equal(r.classification,'applicable');assert.ok(r.changed_files.includes(p));assert.ok(r.changed_files.includes(p+'.moved'));
});
for(const kind of ['missing','invalid_json','scope','capability','workflow','activity','empty','unsafe_path','duplicate'])test('坏候选合同不得N/A：'+kind,async t=>{
 const f=fixture(t);if(kind==='missing')rmSync(join(f.root,contractPath));else if(kind==='invalid_json')f.put(contractPath,'{');else{
 if(kind==='scope')f.contract.scope='zenithjoy';if(kind==='capability')f.contract.capability_id='00000000-0000-4000-8000-000000000001';
 if(kind==='workflow')f.contract.workflows[0].id='00000000-0000-4000-8000-000000000001';if(kind==='activity')f.contract.workflows[0].activities[0].id='00000000-0000-4000-8000-000000000001';
 if(kind==='empty')f.contract.workflows=[];if(kind==='unsafe_path')f.contract.workflows[0].activities[0].bindings=['../escape'];if(kind==='duplicate')f.contract.workflows.push(f.contract.workflows[0]);f.put(contractPath,JSON.stringify(f.contract));}
 await assert.rejects(()=>classify(f),/PATROL_SCOPE_/);
});
test('非法SHA、错误repo、非ancestor均非零',async t=>{
 const f=fixture(t);f.put('unrelated','change');const head=f.commit(),{classifyPatrolDiff}=await api();
 assert.throws(()=>classifyPatrolDiff({repoRoot:f.root,base:'bad',head,registeredRevision:f.base}),/PATROL_SCOPE_/);
 assert.throws(()=>classifyPatrolDiff({repoRoot:f.root,base:head,head:f.base,registeredRevision:f.base}),/PATROL_SCOPE_/);
 f.git('remote','set-url','origin','https://github.com/other/repo.git');assert.throws(()=>classifyPatrolDiff({repoRoot:f.root,base:f.base,head,registeredRevision:f.base}),/PATROL_SCOPE_/);
});
test('坏基线、缺Git对象、伪GitHub host不得分类N/A',async t=>{
 const f=fixture(t),{classifyPatrolDiff}=await api();f.put(contractPath,'{');const badBase=f.commit();f.put(contractPath,JSON.stringify(sourceContract));const head=f.commit();
 assert.throws(()=>classifyPatrolDiff({repoRoot:f.root,base:badBase,head,registeredRevision:f.registeredRevision}),/PATROL_SCOPE_/);
 assert.throws(()=>classifyPatrolDiff({repoRoot:f.root,base:f.base,head:'a'.repeat(40),registeredRevision:f.registeredRevision}),/PATROL_SCOPE_/);
 f.git('remote','set-url','origin','https://evil.invalid/perfectuser21/zenithjoy-workspace.git');assert.throws(()=>classifyPatrolDiff({repoRoot:f.root,base:f.base,head,registeredRevision:f.registeredRevision}),/PATROL_SCOPE_REPO_INVALID/);
});
test('辅助文件删除与未登记巡查新文件仍触发',async t=>{
 const f=fixture(t),aux=f.contract.auxiliary_paths.find(p=>p.endsWith('test_runner.py'));rmSync(join(f.root,aux));f.put('scripts/phone-account-patrol/new-hidden.py','unclaimed\n');const r=await classify(f);
 assert.equal(r.classification,'applicable');assert.ok(r.patrol_paths.includes(aux));assert.ok(r.patrol_paths.includes('scripts/phone-account-patrol/new-hidden.py'));
});
test('真实CLI异常退出非零并只写unknown，不得N/A或PASS',t=>{
 const f=fixture(t),out=join(f.root,'evidence');let failed=false;
 try{execFileSync(process.execPath,[new URL('../implementation-patrol-scope.mjs',import.meta.url).pathname,f.root,'invalid',f.base,out],{stdio:'pipe'})}catch(e){failed=true;assert.equal(e.status,1)}
 assert.equal(failed,true);const r=JSON.parse(readFileSync(join(out,'scope.json')));assert.equal(r.classification,'unknown');assert.equal(r.verdict,undefined);assert.equal(r.receipt,undefined);
});
test('caller永久执行并仅根据成功分类控制巡查；所有事件保留',()=>{
 const w=caller(),job=w.jobs['caller-contract'];assert.equal(w.on.pull_request.paths,undefined);assert.equal(w.on.push.paths,undefined);
 assert.ok(job.steps.some(s=>s.run?.includes('implementation-patrol-scope.test.mjs')));
 assert.ok(w.jobs['scope-classification']);assert.deepEqual(w.jobs.impact.needs,['caller-contract','scope-classification']);
 assert.equal(w.jobs.impact.if,"needs['scope-classification'].outputs.classification == 'applicable'");assert.equal(w.jobs.impact.with.scope,'cecelia-device-patrol');
 const scope=w.jobs['scope-classification'];assert.equal(scope.needs,'caller-contract');assert.equal(scope['continue-on-error'],undefined);
 const step=scope.steps.find(s=>s.id==='scope');assert.equal(step['continue-on-error'],undefined);assert.equal(step.run,'node scripts/ci/implementation-patrol-scope.mjs "$GITHUB_WORKSPACE" "$BASE" "$HEAD" "$RUNNER_TEMP/implementation-scope"');
 assert.deepEqual(step.env,{BASE:'${{ github.event.pull_request.base.sha || inputs.base_revision || github.event.before }}',HEAD:'${{ github.event.pull_request.head.sha || github.sha }}'});
});
test('共享smoke真实隔离消费者守卫：正常执行且巡查失败必非零',async()=>{
 const {verifyPatrolSmokeConsumer}=await api();const root=new URL('../../../',import.meta.url).pathname;
 assert.equal(verifyPatrolSmokeConsumer(root).verified,true);
});
test('共享baseline删巡查、deny巡查不得通过消费者守卫',async t=>{
 const {verifyPatrolSmokeConsumer}=await api(),f=fixture(t);const base='.github/workflows/scripts/smoke-baseline.txt',runner='.github/workflows/ci-smoke-glob-runner.yml';
 f.put(base,'phone-account-patrol-smoke.sh\n');f.put(runner,readFileSync(new URL('../../../'+runner,import.meta.url),'utf8'));
 f.put(base,'other.sh\n');assert.throws(()=>verifyPatrolSmokeConsumer(f.root),/PATROL_SCOPE_/);
 f.put(base,'phone-account-patrol-smoke.sh\n');const y=readFileSync(join(f.root,runner),'utf8');f.put(runner,y.replace('DENYLIST="','DENYLIST="\n          phone-account-patrol-smoke.sh'));assert.throws(()=>verifyPatrolSmokeConsumer(f.root),/PATROL_SCOPE_/);
});
test('真实共享glob paths-ignore不能伪装永久执行',async t=>{
 const {verifyPatrolSmokeConsumer}=await api(),f=fixture(t);f.put('.github/workflows/scripts/smoke-baseline.txt','phone-account-patrol-smoke.sh\n');
 const y=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-smoke-glob-runner.yml',import.meta.url),'utf8'));
 y.on.pull_request['paths-ignore']=['**'];y.on.push['paths-ignore']=['**'];f.put('.github/workflows/ci-smoke-glob-runner.yml',YAML.stringify(y));
 assert.throws(()=>verifyPatrolSmokeConsumer(f.root),/PATROL_SCOPE_/);
});
test('真实caller配置关掉job或node步骤必须被永久协议守卫拒绝',async()=>{
 const {validatePatrolCaller}=await api();assert.equal(validatePatrolCaller(caller()),true);
 for(const target of ['paths-ignore','caller-if','caller-continue','test-if','test-continue','scope-if','scope-step-if']){
  const w=caller();if(target==='paths-ignore')w.on.pull_request['paths-ignore']=['**'];
  if(target==='caller-if')w.jobs['caller-contract'].if='false';if(target==='caller-continue')w.jobs['caller-contract']['continue-on-error']=true;
  const step=w.jobs['caller-contract'].steps.find(s=>s.run?.includes('implementation-patrol-scope.test.mjs'));
  if(target==='test-if')step.if='false';if(target==='test-continue')step['continue-on-error']=true;
  if(target==='scope-if')w.jobs['scope-classification'].if='false';if(target==='scope-step-if')w.jobs['scope-classification'].steps.find(s=>s.id==='scope').if='false';
  assert.throws(()=>validatePatrolCaller(w),/PATROL_SCOPE_/);
 }
});
