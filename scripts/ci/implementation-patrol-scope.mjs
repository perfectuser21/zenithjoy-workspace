/** 巡查范围分类只声明适用性；不是准入PASS，也不缩减原门禁diff。 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync,appendFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {isDeepStrictEqual} from 'node:util';
import {readImplementationSource} from './implementation-skill-source.mjs';

export const CONTRACT_PATH='scripts/phone-account-patrol/implementation-contract.json';
const REGISTERED_REVISION='f0923e5396bade1986ba5452e766cabb5f4a30b3';
const SCOPE='cecelia-device-patrol',REPO='perfectuser21/zenithjoy-workspace';
const PREFIX=dirname(CONTRACT_PATH)+'/';
const dedicated=new Set(['.github/workflows/phone-account-patrol.yml','.github/workflows/scripts/smoke/phone-account-patrol-smoke.sh']);
const fail=(code,detail='')=>{throw Object.assign(Error('PATROL_SCOPE_'+code+(detail?' '+detail:'')),{code:'PATROL_SCOPE_'+code})};
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
 const restore=scope.steps?.findIndex(s=>s.uses==='./.github/actions/skills-source');
 if(!(restore>=0)||restore>=scope.steps.findIndex(s=>s.id==='scope')||scope.steps[restore]['continue-on-error']!==undefined||scope.steps[restore].if!=="hashFiles('.skills-source.json') != ''"||scope.steps[restore].with?.['ssh-key']!=='${{ secrets.SKILLS_SOURCE_SSH_KEY }}')fail('CALLER_DISABLED');
 if(s?.env?.SKILLS_SOURCE_SSH_KEY!=='${{ secrets.SKILLS_SOURCE_SSH_KEY }}')fail('CALLER_DISABLED');
 if(scope.needs!=='caller-contract'||!s||s.if!==undefined||s['continue-on-error']!==undefined||s.run!=='node scripts/ci/implementation-patrol-scope.mjs "$GITHUB_WORKSPACE" "$BASE" "$HEAD" "$RUNNER_TEMP/implementation-scope"')fail('CALLER_DISABLED');
 return true;
}
function dependencyOnlyPatrolWorkflow(before,after){
 try{
  const b=YAML.parse(before.toString()),a=YAML.parse(after.toString());
  const expected={name:'Restore pinned skill sources',if:"hashFiles('.skills-source.json') != ''",uses:'./.github/actions/skills-source',with:{'ssh-key':'${{ secrets.SKILLS_SOURCE_SSH_KEY }}'}};
  const steps=a.jobs?.contract?.steps;
  if(!Array.isArray(steps))return false;
  const matches=steps.map((s,i)=>isDeepStrictEqual(s,expected)?i:-1).filter(i=>i>=0);
  if(matches.length!==1||matches[0]!==steps.findIndex(s=>s.uses==='actions/checkout@v4')+1||matches[0]===0)return false;
  steps.splice(matches[0],1);
  for(const event of ['pull_request','push']){
   const paths=a.on?.[event]?.paths,old=b.on?.[event]?.paths;
   if(!Array.isArray(paths)||!Array.isArray(old)||old.includes('.skills-source.json')||paths.filter(p=>p==='.skills-source.json').length!==1)return false;
   a.on[event].paths=paths.filter(p=>p!=='.skills-source.json');
  }
  return isDeepStrictEqual(a,b);
 }catch{return false}
}
export function classifyPatrolDiff({repoRoot,base,head,registeredRevision=REGISTERED_REVISION,resolveSkill}){
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
 const lockChanged=changed.includes('.skills-source.json');
 let relocation;
 if(lockChanged||touched.some(p=>p.endsWith('.md'))){
  const inventories=new Map([base,head].map(ref=>[ref,new Set(git('ls-tree','-r','--name-only','-z',ref).toString().split('\0').filter(Boolean))]));
  const read=(ref,path)=>{
   if(inventories.get(ref).has(path))return git('show',`${ref}:${path}`);
   // cat accepts only this fixed lock's catalog mappings; an unmapped document fails closed.
   if(path.endsWith('.md')){
    try{
     const bytes=resolveSkill?resolveSkill({repoRoot,ref,path}):readImplementationSource(repoRoot,ref,path);
     if(!Buffer.isBuffer(bytes))fail('SKILL_READ_FAILED');return bytes;
    }catch{fail('SKILL_READ_FAILED')}
   }
   return null;
  };
  // Every scope-owned blob is checked, including dedicated CI and both contracts' bindings.
  const rows=[...owned].sort().map(path=>{
   const b=read(base,path),h=read(head,path);
   const reviewed={'.github/actions/skills-source/action.yml':'90e9d125ed3346871e88d975773796d2c14ee46adf0efe23bd2b92bb2e7ae435','scripts/skills-source.py':'500517f4b1493696062d36aa0c1c45d9b1d63f0093f96ae290aa0f5d8f022ab6','scripts/ensure-skills-source.sh':'d605139c61e0567e8ec0fbe94356ca63f81ece4d613dc6307814a54f20c233d0'};
   const reviewedLoading=()=>Object.entries(reviewed).every(([p,digest])=>inventories.get(head).has(p)&&sha(git('show',`${head}:${p}`))===digest);
   const dependency_only=path==='.github/workflows/phone-account-patrol.yml'&&b!==null&&h!==null&&dependencyOnlyPatrolWorkflow(b,h)&&reviewedLoading();
   return {path,base_sha256:b===null?null:sha(b),head_sha256:h===null?null:sha(h),...(dependency_only?{equivalence:'pinned_skill_dependency_loading'}:{})};
  });
  const equal=r=>r.base_sha256===r.head_sha256||r.equivalence==='pinned_skill_dependency_loading';
  const onlyRelocated=touched.every(path=>owned.has(path)&&((path.endsWith('.md')&&inventories.get(base).has(path)&&!inventories.get(head).has(path))||rows.find(r=>r.path===path)?.equivalence==='pinned_skill_dependency_loading'));
  if(onlyRelocated&&rows.every(equal))relocation={owned_paths:rows,owned_paths_sha256:sha(JSON.stringify(rows))};
  // A lock-only update that changes resolved business bytes must enter the original gate.
  if(lockChanged&&!rows.every(equal))for(const r of rows)if(!equal(r)&&!touched.includes(r.path))touched.push(r.path);
 }

 return {schema_version:1,scope:SCOPE,source_repo:REPO,base_revision:base,head_revision:head,classification:relocation?'not_applicable':touched.length?'applicable':'not_applicable',
  ...(relocation?{reason:'verified_unchanged_skill_relocation',proof:relocation}:{}),
  meaning:'仅分类该固定差异是否触及巡查；不证明仓库或共享CI全部通过',changed_files:changed,patrol_paths:touched,
  contract_source:{path:CONTRACT_PATH,registered_revision:registeredRevision,registered_sha256:sha(registered.bytes),base_sha256:sha(before.bytes),head_sha256:sha(after.bytes)}};
}

/** Verify the actual unconditional L3 patrol caller and run its current offline suite. */
export function verifyPatrolRequiredConsumer(repoRoot){
 const w=YAML.parse(readFileSync(join(repoRoot,'.github/workflows/ci-l3-code.yml'),'utf8'));
 const job=w.jobs?.['api-scripts-test'],gate=w.jobs?.['l3-passed'];
 const command='node --test scripts/phone-account-patrol/implementation-regression.test.mjs';
 const matches=job?.steps?.filter(s=>s.run===command)||[],gateStep=gate?.steps?.find(s=>s.name==='L3 Code Gate');
 const permanent=s=>s&&s.if===undefined&&s['continue-on-error']===undefined;
 if(['pull_request','push','merge_group'].some(event=>!Object.hasOwn(w.on||{},event)||w.on[event]?.paths!==undefined||w.on[event]?.['paths-ignore']!==undefined)||
    !permanent(job)||job.needs!==undefined||!(job['timeout-minutes']>0)||matches.length!==1||!permanent(matches[0])||
    gate?.if!=='always()'||gate['continue-on-error']!==undefined||!gate.needs?.includes('api-scripts-test')||
    !permanent(gateStep)||gateStep.run!=='node scripts/ci/required-gate.mjs code'||gateStep.env?.GATE_NEEDS!=='${{ toJSON(needs) }}')fail('REQUIRED_CONSUMER_DISABLED');
 const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};delete env.NODE_TEST_CONTEXT;
 const run=(args,extra={})=>spawnSync(process.execPath,args,{cwd:repoRoot,env:{...env,...extra},encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
 const result=run(['--test','--test-reporter=tap','scripts/phone-account-patrol/implementation-regression.test.mjs']);
 if(result.error||result.signal||result.status!==0||!(Number(result.stdout.match(/^# tests ([0-9]+)$/m)?.[1])>=2)||!/^# fail 0$/m.test(result.stdout)||!/^# skipped 0$/m.test(result.stdout)||!/^# todo 0$/m.test(result.stdout))fail('REQUIRED_RUNTIME_FAILED');
 const needs=Object.fromEntries(gate.needs.map(job=>[job,{result:'success'}]));
 needs.changes.outputs=Object.fromEntries(['dashboard','api','geoai','ci','agent_modules'].map(key=>[key,'false']));
 for(const state of ['success','failure','cancelled','skipped','missing']){
  if(state==='missing')delete needs['api-scripts-test'];else needs['api-scripts-test']={result:state};
  const r=run(['scripts/ci/required-gate.mjs','code'],{GATE_NEEDS:JSON.stringify(needs)});
  if(r.error||r.signal||(state==='success'?r.status!==0:r.status===0))fail('REQUIRED_GATE_BYPASSED');
 }
 return {runtime_verified:true,gate_failure_skip_blocked:true,workflow:'.github/workflows/ci-l3-code.yml',job:'api-scripts-test',command};
}

// The retired patrol alias is no longer a glob inventory obligation. Its required
// runtime consumer is verified separately; this still exercises both real glob
// workers and the unchanged required aggregate using isolated patrol sentinels.
/** Shared glob consumer: execution, failure and complete shard coverage stay strict. */
export function verifyPatrolSmokeConsumer(repoRoot){
 const name='phone-account-patrol-smoke.sh';
 const w=YAML.parse(readFileSync(join(repoRoot,'.github/workflows/ci-smoke-glob-runner.yml'),'utf8'));
 const worker=w.jobs?.['smoke-glob-shards'],aggregate=w.jobs?.['smoke-glob-runner'],gate=w.jobs?.gate;
 const permanent=s=>s&&s.if===undefined&&s['continue-on-error']===undefined;
 const timed=j=>Number.isFinite(j?.['timeout-minutes'])&&j['timeout-minutes']>0;
 const step=worker?.steps?.find(s=>s.id==='glob'),verify=aggregate?.steps?.find(s=>s.name==='Verify complete shard coverage and original gates');
 const upload=worker?.steps?.find(s=>s.uses==='actions/upload-artifact@v4'),download=aggregate?.steps?.find(s=>s.uses==='actions/download-artifact@v4');
 if(!w.on?.pull_request||!w.on?.push||['pull_request','push'].some(e=>w.on[e].paths!==undefined||w.on[e]['paths-ignore']!==undefined)||
    !permanent(worker)||!timed(worker)||worker.strategy?.['fail-fast']!==false||JSON.stringify(worker.strategy?.matrix)!==JSON.stringify({shard:[0,1]})||
    worker.env?.SMOKE_SHARD_INDEX!=='${{ matrix.shard }}'||worker.env?.SMOKE_SHARD_COUNT!=='2'||!permanent(step)||!step.run||
    upload?.if!=='always()'||upload['continue-on-error']!==undefined||upload.with?.name!=='smoke-glob-shard-${{ matrix.shard }}'||upload.with?.path!=='${{ runner.temp }}/smoke-glob-shard-${{ matrix.shard }}/'||upload.with?.['if-no-files-found']!=='error'||
    aggregate?.name!=='Smoke Glob Runner'||aggregate.if!=='always()'||aggregate['continue-on-error']!==undefined||!timed(aggregate)||JSON.stringify(aggregate.needs)!==JSON.stringify(['smoke-glob-shards'])||
    aggregate.env?.SMOKE_ARTIFACTS!=='smoke-shard-reports'||aggregate.env?.SMOKE_SHARDS_RESULT!=='${{ needs.smoke-glob-shards.result }}'||!permanent(verify)||!verify.run||
    !permanent(download)||download.with?.pattern!=='smoke-glob-shard-*'||download.with?.path!=='smoke-shard-reports'||
    gate?.name!=='Smoke Glob Gate Passed'||gate.if!=="always() && (github.event_name == 'pull_request' || github.event_name == 'merge_group')"||gate['continue-on-error']!==undefined||!timed(gate)||
    JSON.stringify(gate.needs)!==JSON.stringify(['smoke-glob-runner','baseline-lint'])||!gate.steps?.length||gate.steps.some(s=>!permanent(s)||!s.run))fail('SMOKE_DISABLED');
 const root=mkdtempSync(join(tmpdir(),'patrol-smoke-consumer-'));
 try{
  const dir=join(root,'.github/workflows/scripts/smoke'),reports=join(root,'reports');mkdirSync(dir,{recursive:true});mkdirSync(reports);
  const companion='a-consumer-smoke.sh',source='f'.repeat(40);
  // The real worker now consumes a reviewed selector and two exclusion manifests.
  // Recreate those dependencies inside this isolated fixture. Helpers and
  // duplicate probes are inert sentinels: an accidental invocation must fail,
  // never operate a physical device or call an external API.
  const selectionPaths=['.github/workflows/scripts/smoke-selection.py',
   '.github/workflows/scripts/smoke-helpers.json',
   '.github/workflows/scripts/smoke-required-duplicates.json',
   '.github/workflows/ci-l4-e2e-smoke.yml'];
  const put=(path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text)};
  try{
   for(const path of selectionPaths)put(path,readFileSync(join(repoRoot,path),'utf8'));
   const helpers=JSON.parse(readFileSync(join(root,selectionPaths[1]),'utf8')).helpers;
   const duplicates=JSON.parse(readFileSync(join(root,selectionPaths[2]),'utf8')).duplicates;
   if(!Array.isArray(helpers)||!Array.isArray(duplicates))fail('SMOKE_SELECTION_DEPENDENCY_INVALID');
   for(const helper of helpers){
    if(!Array.isArray(helper.consumers))fail('SMOKE_SELECTION_DEPENDENCY_INVALID');
    for(const path of helper.consumers){
     if(typeof path!=='string'||!/^[-\w./]+$/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))fail('SMOKE_SELECTION_DEPENDENCY_INVALID');
     put(path,readFileSync(join(repoRoot,path),'utf8'));
    }
   }
   for(const record of [...helpers,...duplicates]){
    if(typeof record.name!=='string'||!/^[-\w.]+\.sh$/.test(record.name))fail('SMOKE_SELECTION_DEPENDENCY_INVALID');
    put('.github/workflows/scripts/smoke/'+record.name,'#!/bin/bash\n# Inert fixture references: '+helpers.map(h=>h.name).join(', ')+'\nexit 97\n');
   }
  }catch{fail('SMOKE_SELECTION_DEPENDENCY_INVALID')}
  writeFileSync(join(dirname(dir),'smoke-baseline.txt'),companion+'\n'+name+'\n');
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin',HOME:root,CI:'true',GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:source,GITHUB_STEP_SUMMARY:join(root,'summary'),RUNNER_TEMP:reports,SMOKE_SHARD_COUNT:'2',SMOKE_ARTIFACTS:reports};
  const run=(script,extra={})=>spawnSync('/bin/bash',['-c',script],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
  const ok=r=>!r.error&&!r.signal&&r.status===0;
  const requireBlocked=r=>{if(r.error||r.signal||r.status===0)fail('SMOKE_CONSUMER_BYPASSED')};
  const gateRun=(result,lint)=>gate.steps.map(s=>s.run).join('\n').replaceAll('${{ needs.smoke-glob-runner.result }}',result).replaceAll('${{ needs.baseline-lint.result }}',lint);
  if(!ok(run(gateRun('success','success'))))fail('SMOKE_CONSUMER_BYPASSED');
  // merge_group currently has no equivalent per-PR baseline deletion review: it must fail closed.
  requireBlocked(run(gateRun('success','success'),{GITHUB_EVENT_NAME:'merge_group'}));
  requireBlocked(run(gateRun('failure','success')));requireBlocked(run(gateRun('success','failure')));
  for(const exitCode of [0,1]){
   const marker=join(root,'ran-'+exitCode),other=join(root,'companion-'+exitCode);
   writeFileSync(join(dir,companion),`#!/bin/bash\nprintf executed >> '${other}'\nexit 0\n`);
   writeFileSync(join(dir,name),`#!/bin/bash\nprintf executed >> '${marker}'\nexit ${exitCode}\n`);
   const workers=[0,1].map(i=>run(step.run,{SMOKE_SHARD_INDEX:String(i)}));
   if(!existsSync(marker)||!existsSync(other)||readFileSync(other,'utf8')!=='executed'||readFileSync(marker,'utf8')!==(exitCode?'executedexecuted':'executed'))fail('SMOKE_CONSUMER_BYPASSED',JSON.stringify(workers.map(r=>({status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}))));
   const result=workers.every(ok)?'success':'failure';
   if(exitCode){if(!ok(workers[0]))fail('SMOKE_CONSUMER_BYPASSED',JSON.stringify(workers.map(r=>({status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}))));requireBlocked(workers[1]);requireBlocked(run(verify.run,{SMOKE_SHARDS_RESULT:result}));continue}
   if(result!=='success'||!ok(run(verify.run,{SMOKE_SHARDS_RESULT:result})))fail('SMOKE_CONSUMER_BYPASSED');
   // 使用真实聚合器及真实worker产物证明不可漏覆盖、串source或吞worker失败。
   requireBlocked(run(verify.run,{SMOKE_SHARDS_RESULT:'failure'}));
   const metaPath=join(reports,'smoke-glob-shard-1/manifest.json'),rowsPath=join(reports,'smoke-glob-shard-1/results.tsv');
   const originalMeta=readFileSync(metaPath,'utf8'),originalRows=readFileSync(rowsPath,'utf8');
   const meta=JSON.parse(originalMeta);meta.source_sha='e'.repeat(40);writeFileSync(metaPath,JSON.stringify(meta));
   requireBlocked(run(verify.run,{SMOKE_SHARDS_RESULT:'success'}));writeFileSync(metaPath,originalMeta);
   writeFileSync(rowsPath,'');requireBlocked(run(verify.run,{SMOKE_SHARDS_RESULT:'success'}));writeFileSync(rowsPath,originalRows);
  }
  return {verified:true,scope:'development_governance',source_sha256:sha(step.run+'\n'+verify.run),success_executed:true,failure_blocked:true,shards_executed:2,aggregate_verified:true,coverage_source_failure_blocked:true};
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
