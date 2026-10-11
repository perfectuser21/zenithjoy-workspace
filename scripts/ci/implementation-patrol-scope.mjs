/** 巡查范围分类只声明适用性；不是准入PASS，也不缩减原门禁diff。 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync,appendFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import YAML from 'yaml';

export const CONTRACT_PATH='scripts/phone-account-patrol/implementation-contract.json';
const REGISTERED_REVISION='f0923e5396bade1986ba5452e766cabb5f4a30b3';
const SCOPE='cecelia-device-patrol',REPO='perfectuser21/zenithjoy-workspace';
const PREFIX=dirname(CONTRACT_PATH)+'/';
const dedicated=new Set(['.github/workflows/phone-account-patrol.yml','.github/workflows/scripts/smoke/phone-account-patrol-smoke.sh']);
const fail=code=>{throw Object.assign(Error('PATROL_SCOPE_'+code),{code:'PATROL_SCOPE_'+code})};
const sha=v=>createHash('sha256').update(v).digest('hex');
const revision=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const safePath=p=>typeof p==='string'&&p.startsWith(PREFIX)&&/^[-\w./]+$/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..');
function validate(c){
 if(c?.schema_version!==1||c.scope!==SCOPE||!uuid(c.capability_id)||!Array.isArray(c.workflows)||!c.workflows.length)fail('CONTRACT_INVALID');
 const workflows=new Set(),activities=new Set();
 for(const w of c.workflows){
  if(!uuid(w.id)||workflows.has(w.id)||typeof w.key!=='string'||!w.key||!Array.isArray(w.activities)||!w.activities.length)fail('CONTRACT_INVALID');workflows.add(w.id);
  for(const a of w.activities){
   if(!uuid(a.id)||activities.has(a.id)||typeof a.key!=='string'||!a.key||typeof a.assertion_ref!=='string'||!a.assertion_ref||!Array.isArray(a.bindings)||!a.bindings.length||a.bindings.some(p=>!safePath(p)))fail('CONTRACT_INVALID');activities.add(a.id);
  }
 }
 if(!Array.isArray(c.auxiliary_paths)||c.auxiliary_paths.some(p=>!safePath(p))||new Set(c.auxiliary_paths).size!==c.auxiliary_paths.length||!c.auxiliary_paths.includes(CONTRACT_PATH))fail('CONTRACT_INVALID');
 return c;
}
const identity=c=>JSON.stringify({scope:c.scope,capability_id:c.capability_id,workflows:c.workflows.map(w=>({id:w.id,key:w.key,activities:w.activities.map(a=>({id:a.id,key:a.key,assertion_ref:a.assertion_ref}))}))});
export function validatePatrolCaller(w){
 for(const event of ['pull_request','push'])if(!w.on?.[event]||w.on[event].paths!==undefined||w.on[event]['paths-ignore']!==undefined)fail('CALLER_DISABLED');
 const caller=w.jobs?.['caller-contract'],scope=w.jobs?.['scope-classification'];
 for(const j of [caller,scope])if(!j||j.if!==undefined||j['continue-on-error']!==undefined)fail('CALLER_DISABLED');
 for(const command of ['implementation-impact-workflow.test.mjs','pilot-release-workflow.test.mjs','implementation-patrol-scope.test.mjs']){
  const s=caller.steps?.find(s=>s.run===`node --test scripts/ci/__tests__/${command}`);
  if(!s||s.if!==undefined||s['continue-on-error']!==undefined)fail('CALLER_DISABLED');
 }
 const s=scope.steps?.find(s=>s.id==='scope');
 if(scope.needs!=='caller-contract'||!s||s.if!==undefined||s['continue-on-error']!==undefined||s.run!=='node scripts/ci/implementation-patrol-scope.mjs "$GITHUB_WORKSPACE" "$BASE" "$HEAD" "$RUNNER_TEMP/implementation-scope"')fail('CALLER_DISABLED');
 return true;
}
export function classifyPatrolDiff({repoRoot,base,head,registeredRevision=REGISTERED_REVISION}){
 if(![base,head,registeredRevision].every(revision))fail('REVISION_INVALID');
 const git=(...args)=>{try{return execFileSync('git',args,{cwd:repoRoot,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']})}catch{fail('GIT_READ_FAILED')}};
 const remote=git('remote','get-url','origin').toString().trim();
 if(![`https://github.com/${REPO}`,`https://github.com/${REPO}.git`,`git@github.com:${REPO}`,`git@github.com:${REPO}.git`].includes(remote))fail('REPO_INVALID');
 git('merge-base','--is-ancestor',registeredRevision,base);git('merge-base','--is-ancestor',base,head);
 const readContract=r=>{const bytes=git('show',`${r}:${CONTRACT_PATH}`);let c;try{c=JSON.parse(bytes)}catch{fail('CONTRACT_INVALID')}return {bytes,contract:validate(c)}};
 const registered=readContract(registeredRevision),before=readContract(base),after=readContract(head);
 if(identity(before.contract)!==identity(registered.contract)||identity(after.contract)!==identity(registered.contract))fail('IDENTITY_CHANGED');
 const owned=new Set([CONTRACT_PATH,...dedicated]);
 for(const c of [before.contract,after.contract])for(const p of [...c.workflows.flatMap(w=>w.activities.flatMap(a=>a.bindings)),...c.auxiliary_paths])owned.add(p);
 const changed=git('diff','--no-renames','--name-only','-z',base,head,'--').toString().split('\0').filter(Boolean);
 // 未登记的巡查目录新增也交原门禁拒绝；不得因未在bindings里就悄悄N/A。
 const touched=changed.filter(p=>owned.has(p)||p.startsWith(PREFIX));
 return {schema_version:1,scope:SCOPE,source_repo:REPO,base_revision:base,head_revision:head,classification:touched.length?'applicable':'not_applicable',
  meaning:'仅分类该固定差异是否触及巡查；不证明仓库或共享CI全部通过',changed_files:changed,patrol_paths:touched,
  contract_source:{path:CONTRACT_PATH,registered_revision:registeredRevision,registered_sha256:sha(registered.bytes),base_sha256:sha(before.bytes),head_sha256:sha(after.bytes)}};
}

/** 真跑共享glob的隔离巡查消费者：成功须执行，失败须阻断。无手机、数据库或API。 */
export function verifyPatrolSmokeConsumer(repoRoot){
 const name='phone-account-patrol-smoke.sh',baseline=readFileSync(join(repoRoot,'.github/workflows/scripts/smoke-baseline.txt'),'utf8');
 if(!baseline.split(/\r?\n/).includes(name))fail('SMOKE_BASELINE_REMOVED');
 const w=YAML.parse(readFileSync(join(repoRoot,'.github/workflows/ci-smoke-glob-runner.yml'),'utf8')),j=w.jobs?.['smoke-glob-runner'];
 if(!w.on?.pull_request||!w.on?.push||['pull_request','push'].some(e=>w.on[e].paths!==undefined||w.on[e]['paths-ignore']!==undefined)||j?.if!==undefined||j?.['continue-on-error']!==undefined||!Number.isFinite(j?.['timeout-minutes']))fail('SMOKE_DISABLED');
 const step=j.steps.find(s=>s.id==='glob');if(!step?.run||step.if!==undefined||step['continue-on-error']!==undefined)fail('SMOKE_DISABLED');
 const root=mkdtempSync(join(tmpdir(),'patrol-smoke-consumer-'));
 try{
  const dir=join(root,'.github/workflows/scripts/smoke');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dirname(dir),'smoke-baseline.txt'),name+'\n');
  for(const exitCode of [0,1]){
   const marker=join(root,'ran-'+exitCode);writeFileSync(join(dir,name),`#!/bin/bash\nprintf executed >> '${marker}'\nexit ${exitCode}\n`);
   const r=spawnSync('/bin/bash',['-c',step.run],{cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin',HOME:root,CI:'true',GITHUB_STEP_SUMMARY:join(root,'summary')},encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
   if(r.error||r.signal||!existsSync(marker)||(exitCode===0?r.status!==0:r.status===0))fail('SMOKE_CONSUMER_BYPASSED');
  }
  return {verified:true,scope:'development_governance',source_sha256:sha(step.run),success_executed:true,failure_blocked:true};
 }finally{rmSync(root,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [repoRoot,base,head,out]=process.argv.slice(2);
 try{
  if(!repoRoot||!out||process.argv.length!==6)fail('INPUT_INVALID');mkdirSync(out,{recursive:true});
  const result=classifyPatrolDiff({repoRoot,base,head});writeFileSync(join(out,'scope.json'),JSON.stringify(result,null,2)+'\n');
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`classification=${result.classification}\n`);
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){if(out){mkdirSync(out,{recursive:true});writeFileSync(join(out,'scope.json'),JSON.stringify({classification:'unknown',code:e.code||'PATROL_SCOPE_ERROR'})+'\n')}process.stderr.write((e.code||'PATROL_SCOPE_ERROR')+'\n');process.exitCode=1}
}
