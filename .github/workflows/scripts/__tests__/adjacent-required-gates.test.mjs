import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const profiles=[
 {name:'wechat',file:'wechat-cs-e2e.yml',gate:'wechat-cs-gate',routes:['agent_or_api','agent'],paths:[['apps/api/src/routes/wechat.ts','agent_or_api'],['services/agent/runtime.py','agent'],['services/agent/package-lock.json','agent'],['package-lock.json','agent_or_api'],['apps/creator/package.json','agent_or_api'],['scripts/ci/detect-changes.mjs','agent_or_api']],neighbor:'services/agent-old/runtime.py',manual:true},
 {name:'lead',file:'e2e-line02-lead-human-handoff-windows.yml',gate:'lead-gate',routes:['lead','lead_windows'],paths:[['apps/api/src/routes/acquisition.ts','lead'],['apps/api/src/services/tenant.service.ts','lead'],['apps/dashboard/src/components/LeadsTable.tsx','lead'],['apps/dashboard/vite.config.ts','lead'],['services/agent/src/line02/reply-poller.ts','lead'],['package-lock.json','lead'],['scripts/ci/detect-changes.mjs','lead']],neighbor:'apps/dashboard-old/src/page.tsx',manual:true},
 {name:'orphan',file:'e2e-orphan-consolidation-windows.yml',gate:'orphan-e2e-gate',routes:['orphan'],paths:[['apps/dashboard/e2e/module-health.spec.ts','orphan'],['apps/dashboard/src/pages/Page.tsx','orphan'],['apps/dashboard/playwright.config.ts','orphan'],['apps/api/src/routes/agent.ts','orphan'],['package-lock.json','orphan'],['scripts/ci/detect-changes.mjs','orphan']],neighbor:'apps/dashboard-old/src/page.tsx',manual:true},
 {name:'android',file:'android-agent-ci.yml',gate:'android-ci-gate',routes:['android'],paths:[['services/agent-android/app/build.gradle.kts','android'],['services/agent-android/gradle.properties','android'],['.skills-source.json','android'],['scripts/ci/detect-changes.mjs','android']],neighbor:'services/agent-android-old/app/build.gradle.kts'},
];
function git(cwd,args){const r=spawnSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'CI fixture',GIT_AUTHOR_EMAIL:'ci@example.test',GIT_COMMITTER_NAME:'CI fixture',GIT_COMMITTER_EMAIL:'ci@example.test'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function workflow(p){const source=process.env.CI_GATE_TEST_BASELINE?git(root,['show',`${process.env.CI_GATE_TEST_BASELINE}:.github/workflows/${p.file}`]):readFileSync(join(root,'.github/workflows',p.file),'utf8');return parse(source);}
function temp(fn){const dir=mkdtempSync(join(tmpdir(),'adjacent-ci-'));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function render(text,context){return text.replace(/\$\{\{\s*(.*?)\s*\}\}/g,(_,expression)=>expression==='toJSON(needs)'?JSON.stringify(context.needs):expression.split('.').reduce((v,k)=>v?.[k],context)??'');}
function runStep(step,context,cwd,extra={}){const env={...process.env,...extra};for(const[key,value]of Object.entries(step.env??{}))env[key]=render(String(value),context);return spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',render(step.run,context)],{cwd,env,encoding:'utf8'});}
function aggregate(p,{result='success',outputs=Object.fromEntries(p.routes.map(key=>[key,'false'])),jobs={},absent=[]}={}){
 const w=workflow(p),needs=Object.fromEntries(w.jobs[p.gate].needs.map(key=>[key,{result:'skipped'}]));needs.changes={result,outputs};for(const[key,value]of Object.entries(jobs))needs[key]={result:value};for(const key of absent)delete needs[key];
 let resultStep;for(const step of w.jobs[p.gate].steps.filter(step=>step.run)){resultStep=runStep(step,{needs},root);if(resultStep.status!==0)break;}return resultStep;
}
function fixture(dir,path){git(dir,['init','-q']);writeFileSync(join(dir,'README.md'),'base');git(dir,['add','.']);const base=git(dir,['commit-tree',git(dir,['write-tree']),'-m','base']);mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),'changed');git(dir,['add','.']);const head=git(dir,['commit-tree',git(dir,['write-tree']),'-p',base,'-m','head']);git(dir,['update-ref','refs/remotes/origin/main',base]);git(dir,['update-ref','refs/heads/change',head]);git(dir,['symbolic-ref','HEAD','refs/heads/change']);mkdirSync(join(dir,'scripts/ci'),{recursive:true});cpSync(join(root,'scripts/ci'),join(dir,'scripts/ci'),{recursive:true});return{base,head};}
function detect(p,dir,eventName,event,head){event=eventName==='push'?{before:event.before,after:event.after}:eventName==='pull_request'?{pull_request:event.pull_request}:eventName==='merge_group'?{merge_group:event.merge_group}:event;const eventPath=join(dir,'event.json'),output=join(dir,'outputs');writeFileSync(eventPath,JSON.stringify(event));writeFileSync(output,'');const step=workflow(p).jobs.changes.steps.find(step=>step.id==='filter');const r=runStep(step,{github:{event,event_name:eventName,base_ref:eventName==='pull_request'?'main':'',sha:head,workspace:dir},runner:{temp:dir}},dir,{GITHUB_EVENT_NAME:eventName,GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:output,GITHUB_WORKSPACE:dir,RUNNER_TEMP:dir});return{...r,outputs:Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>line.split('=')))};}
const event=(base,head)=>({before:base,after:head,pull_request:{base:{sha:base},head:{sha:head}},merge_group:{base_sha:base,head_sha:head}});
for(const p of profiles){
 test(`${p.name}: every child is retained in required aggregate needs`,()=>{const w=workflow(p);assert.deepEqual(w.jobs[p.gate].needs.slice().sort(),Object.keys(w.jobs).filter(key=>key!==p.gate).sort());});
 test(`${p.name}: required context subscribes to merge_group`,()=>assert.ok(Object.hasOwn(workflow(p).on,'merge_group')));
 test(`${p.name}: legitimate unrelated diff skips conditional jobs`,()=>assert.equal(aggregate(p).status,0));
 for(const result of ['failure','cancelled','skipped',''])test(`${p.name}: changes ${result||'empty'} rejects aggregate`,()=>assert.notEqual(aggregate(p,{result}).status,0));
 for(const route of p.routes)for(const value of [undefined,'','TRUE','unexpected'])test(`${p.name}: ${route} output ${String(value)} rejects aggregate`,()=>{const outputs=Object.fromEntries(p.routes.map(key=>[key,'false']));if(value===undefined)delete outputs[route];else outputs[route]=value;assert.notEqual(aggregate(p,{outputs}).status,0);});
 for(const job of workflow(p).jobs[p.gate].needs.filter(key=>key!=='changes')){
  test(`${p.name}: unselected ${job} skipped or absent is legal`,()=>{assert.equal(aggregate(p).status,0);assert.equal(aggregate(p,{absent:[job]}).status,0);});
  for(const result of ['failure','cancelled'])test(`${p.name}: unselected ${job} ${result} cannot hide behind false route`,()=>assert.notEqual(aggregate(p,{jobs:{[job]:result}}).status,0));
 }
 for(const route of p.routes)test(`${p.name}: ${route} selects actual job conditions and rejects selected skips`,()=>{
  const w=workflow(p),outputs=Object.fromEntries(p.routes.map(key=>[key,key===route?'true':'false'])),needs={changes:{outputs}},jobs=Object.fromEntries(w.jobs[p.gate].needs.filter(key=>key!=='changes').map(key=>[key,Function('needs','github',`return (${w.jobs[key].if})`)(needs,{event_name:route==='lead_windows'?'workflow_dispatch':'pull_request'})?'success':'skipped']));
  assert.equal(aggregate(p,{outputs,jobs}).status,0);
  for(const[key,result]of Object.entries(jobs))if(result==='success')for(const invalid of ['failure','cancelled','skipped',''])assert.notEqual(aggregate(p,{outputs,jobs:{...jobs,[key]:invalid}}).status,0,`${key}=${invalid}`);
 });
 for(const[path,route]of p.paths)for(const name of ['push','pull_request','merge_group']){
  if(name==='push'&&p.name==='lead')continue;
  test(`${p.name}: real ${name} diff ${path} selects ${route}`,()=>temp(dir=>{const{base,head}=fixture(dir,path),r=detect(p,dir,name,event(base,head),head);assert.equal(r.status,0,r.stderr);assert.equal(r.outputs[route],'true',JSON.stringify(r.outputs));for(const key of p.routes)assert.match(r.outputs[key]??'',/^(true|false)$/);}));
 }
 for(const name of ['pull_request','merge_group']){
  test(`${p.name}: ${name} event SHAs override unrelated checkout HEAD`,()=>temp(dir=>{const{base,head}=fixture(dir,p.paths[0][0]),r=detect(p,dir,name,event(base,base),head);assert.equal(r.status,0,r.stderr);for(const key of p.routes)assert.equal(r.outputs[key],'false');}));
  for(const invalid of ['', '0'.repeat(40), 'f'.repeat(40)])test(`${p.name}: ${name} missing/unreadable head ${invalid} fails instead of empty diff`,()=>temp(dir=>{const{base,head}=fixture(dir,p.paths[0][0]),r=detect(p,dir,name,event(base,invalid),head);assert.notEqual(r.status,0,r.stdout+r.stderr);}));
 }
 test(`${p.name}: neighboring path stays unselected`,()=>temp(dir=>{const{base,head}=fixture(dir,p.neighbor),r=detect(p,dir,'pull_request',event(base,head),head);assert.equal(r.status,0,r.stderr);for(const key of p.routes)assert.equal(r.outputs[key],'false');}));
 if(p.name==='lead')test('lead: manual Windows evaluator must succeed only when dispatched',()=>{
  const outputs={lead:'true',lead_windows:'true'};
  assert.equal(aggregate(p,{outputs,jobs:{e2e:'success','e2e-windows':'success'}}).status,0);
  for(const result of ['failure','cancelled','skipped',''])assert.notEqual(aggregate(p,{outputs,jobs:{e2e:'success','e2e-windows':result}}).status,0,result);
  assert.equal(workflow(p).jobs['e2e-windows'].if,"github.event_name == 'workflow_dispatch'");
  assert.equal(aggregate(p,{outputs:{lead:'true',lead_windows:'false'},jobs:{e2e:'success','e2e-windows':'skipped'}}).status,0);
 });
 if(p.manual)test(`${p.name}: manual dispatch explicitly runs all checks`,()=>temp(dir=>{const{head}=fixture(dir,'docs/unrelated.md'),r=detect(p,dir,'workflow_dispatch',{},head);assert.equal(r.status,0,r.stderr);for(const key of p.routes)assert.equal(r.outputs[key],'true');}));
}
