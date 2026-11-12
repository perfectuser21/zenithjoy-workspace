import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {validatePatrolCaller} from '../implementation-patrol-scope.mjs';
const file=new URL('../../../.github/workflows/pilot-release-verification.yml',import.meta.url);
// Cecelia PR #6558 的实际合并提交；固定正式工具来源，不使用候选分支。
const revision='0ed23d135ba1fa977db71d70bb742e8522c07917';
function config(){assert.ok(existsSync(file),'独立完整发布验证caller必须存在');return YAML.parse(readFileSync(file,'utf8'));}
test('完整发布caller名称与路径固定，仅main push/手动触发，不借PR影响结果',()=>{
 const w=config();assert.equal(w.name,'Pilot release verification');
 assert.deepEqual(Object.keys(w.on).sort(),['push','workflow_dispatch']);assert.deepEqual(w.on.push.branches,['main']);
 assert.equal(w.on.push.paths,undefined);assert.equal(w.concurrency,undefined);
 assert.equal(w.jobs.verify.if,"github.ref == 'refs/heads/main'");
});
test('完整发布使用同次提交的本地入口，工具仍固定实际合并SHA且只传四项输入',()=>{
 const j=config().jobs.verify;
 assert.equal(j.uses,'./.github/workflows/pilot-release-regression.yml');
 assert.deepEqual(j.with,{source_repo:'perfectuser21/zenithjoy-workspace',scope:'zenithjoy',head_revision:'${{ github.sha }}',tooling_revision:revision});
 assert.equal(j['continue-on-error'],undefined);assert.deepEqual(j.needs,['caller-contract','authoring-main-source']);
});
test('通用Commander复用完整发布验证并保留原zenithjoy范围',()=>{
 const w=config(),j=w.jobs['verify-commander'];
 assert.ok(j,'commander-generic须有独立完整发布验证');
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.deepEqual(j.needs,['caller-contract','authoring-main-source']);
 assert.equal(j.uses,w.jobs.verify.uses);
 assert.deepEqual(j.with,{...w.jobs.verify.with,scope:'commander-generic'});
 assert.deepEqual(j.secrets,w.jobs.verify.secrets);
 assert.equal(j['continue-on-error'],undefined);
 assert.equal(w.jobs.verify.with.scope,'zenithjoy');
});
test('发布caller显式传中央Skill只读凭据及原三项secret，保read权限和实际main拒绝闸',()=>{
 const w=config();assert.deepEqual(w.permissions,{contents:'read',actions:'read'});
 assert.deepEqual(w.jobs.verify.secrets,{TS_AUTHKEY:'${{ secrets.TS_AUTHKEY }}',CECELIA_INTERNAL_TOKEN:'${{ secrets.CECELIA_INTERNAL_TOKEN }}',BRAIN_DEPLOY_URL:'${{ secrets.BRAIN_DEPLOY_URL }}',SKILLS_SOURCE_SSH_KEY:'${{ secrets.SKILLS_SOURCE_SSH_KEY }}'});
 const guard=w.jobs['caller-contract'].steps.find(s=>s.env?.RUN_REF==='${{ github.ref }}');
 assert.equal(guard.run,'test "$RUN_REF" = refs/heads/main');
});
test('发布协议断言在现有PR检查和自身main检查永久执行，旧影响caller保留',()=>{
 const command='node --test scripts/ci/__tests__/pilot-release-workflow.test.mjs';
 const w=config(),legacy=YAML.parse(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 assert.ok(w.jobs['caller-contract'].steps.some(s=>s.run===command));
 assert.ok(legacy.jobs['caller-contract'].steps.some(s=>s.run===command));
 assert.ok(legacy.on.pull_request);assert.match(legacy.jobs.impact.uses,/\/implementation-impact.yml@[a-f0-9]{40}$/);
 assert.equal(validatePatrolCaller(legacy),true,'独立Pilot协议守卫也拒绝禁用旧caller，避免自检job关闭后失声');
});
test('巡查定义有独立完整发布证明，保留现有范围且不以影响N/A冒充通过',()=>{
 const w=config(),j=w.jobs['verify-patrol-definitions'];
 assert.ok(j,'cecelia-device-patrol-definitions须有独立完整发布验证');
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.deepEqual(j.needs,['caller-contract','authoring-main-source']);
 assert.equal(j.uses,w.jobs.verify.uses);
 assert.deepEqual(j.with,{...w.jobs.verify.with,scope:'cecelia-device-patrol-definitions'});
 assert.deepEqual(j.secrets,w.jobs.verify.secrets);
 assert.equal(j['continue-on-error'],undefined);
});

function regression(){return YAML.parse(readFileSync(new URL('../../../.github/workflows/pilot-release-regression.yml',import.meta.url),'utf8'));}
function extractSnapshot(input){
 const step=regression().jobs.verify.steps.find(s=>s.name==='准备固定中央Skill对象缓存');
 const command=step.run.split('\n').find(line=>line.trimStart().startsWith('jq '));
 assert.ok(command,'执行实际工作流中的快照转换命令');
 const root=mkdtempSync(join(tmpdir(),'pilot-snapshot-'));
 try{
  mkdirSync(join(root,'snapshot'));writeFileSync(join(root,'snapshot/head.json'),input);
  const result=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:root,encoding:'utf8'});
  const target=join(root,'snapshot/canonical.json');
  return {...result,canonical:existsSync(target)?readFileSync(target,'utf8'):''};
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('完整发布本地兼容入口仅允许被调用，固定工具、同SHA及真实回归合同保留',()=>{
 const w=regression();assert.deepEqual(Object.keys(w.on),['workflow_call']);
 assert.deepEqual(Object.keys(w.on.workflow_call.inputs).sort(),['head_revision','scope','source_repo','tooling_revision']);
 assert.equal(w.jobs.verify.needs,'snapshot');assert.equal(w.jobs.verify['timeout-minutes'],40);
 const steps=w.jobs.verify.steps;
 assert.equal(steps.find(s=>s.with?.path==='tooling').with.ref,'${{ inputs.tooling_revision || github.sha }}');
 assert.equal(steps.find(s=>s.with?.path==='source').with.ref,'${{ inputs.head_revision || github.sha }}');
 assert.ok(steps.some(s=>s.run?.includes('node tooling/scripts/ci/pilot-release-verification.mjs --repo-root "$PWD/source"')));
 assert.ok(steps.some(s=>s.run?.includes('--snapshot "$PWD/snapshot/head.json"')));
 assert.ok(w.jobs.snapshot.steps.some(s=>s.run?.includes('.snapshot.status == "verified" and (.snapshot.gaps | length == 0)')));
});
test('真实工作流转换保持大型快照完整且紧凑，避免漂亮格式越过原4MiB文件上限',()=>{
 const snapshot={status:'verified',items:Array.from({length:90000},(_,id)=>({id,value:'abcdefghijklmnop'}))};
 const limit=4*1024*1024;
 assert.ok(Buffer.byteLength(JSON.stringify(snapshot,null,2))>limit,'触发原漂亮格式膨胀');
 const result=extractSnapshot(JSON.stringify({snapshot}));
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.canonical),snapshot,'不裁剪、更改或过滤规范快照内容');
 assert.ok(Buffer.byteLength(result.canonical)<limit,'仍遵守原4MiB上限');
});
test('真实工作流快照转换拒绝空输入、缺失及非对象，不产出可接受的规范快照',()=>{
 for(const input of ['', '{}', '{"snapshot":null}', '{"snapshot":[]}', '{"snapshot":"verified"}', '{']){
  const result=extractSnapshot(input);assert.notEqual(result.status,0,`不得接受${JSON.stringify(input)}`);
  assert.equal(result.canonical.trim(),'');
 }
});
