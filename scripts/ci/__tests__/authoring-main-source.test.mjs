import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
const root=new URL('../../../',import.meta.url);
test('五个既有正式定义升patch且保留Patrol实际固定部署来源',()=>{
 for(const [path,version] of [
 ['commander/contracts/workflow-commander.json','2.0.33'],['commander/contracts/workflow-report.json','1.0.34'],
 ['patrol/contracts/single.json','0.1.25'],['patrol/contracts/batch.json','0.1.25'],['patrol/contracts/maintenance.json','0.1.24']]){
  const d=JSON.parse(readFileSync(new URL(`services/phone-adb-controller/${path}`,root)));
  assert.match(d.version,/^[0-9]+\.[0-9]+\.[0-9]+$/);assert.equal(d.source,undefined);
  if(path.startsWith('patrol'))for(const a of d.activities)assert.match(a.implementation.revision,/^[a-f0-9]{40}$/);
 }
});
test('三个Pilot必须等待main正式来源续版，PR也永久执行前置契约回归',()=>{
 const w=YAML.parse(readFileSync(new URL('.github/workflows/pilot-release-verification.yml',root),'utf8'));
 const j=w.jobs['authoring-main-source'];assert.ok(j,'缺来源登记前置');
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.equal(j['continue-on-error'],undefined);
 assert.ok(j.steps.some(s=>s.run==='node scripts/ci/authoring-main-source.mjs'));
 assert.equal(j.services.postgres.env.POSTGRES_DB,'cecelia_scratch');
 assert.equal(j.services.postgres.image,'mirror.gcr.io/pgvector/pgvector:pg15');
 assert.deepEqual(j.concurrency,{group:'authoring-main-source-${{ github.repository }}','cancel-in-progress':false});
 for(const key of ['verify','verify-commander','verify-patrol-definitions'])assert.deepEqual(w.jobs[key].needs,['caller-contract','authoring-main-source']);
 const impact=YAML.parse(readFileSync(new URL('.github/workflows/implementation-impact.yml',root),'utf8'));
 assert.ok(impact.jobs['caller-contract'].steps.some(s=>s.run==='node --test scripts/ci/__tests__/authoring-main-source.test.mjs scripts/ci/__tests__/authoring-source-version.test.mjs'));
});
test('编排器在登记任务之后真实验证、生产register前重核main、map必须传事务CAS',async()=>{
 const {renewDefinitions}=await import('../authoring-main-source-core.mjs');
 const calls=[];const digest='d'.repeat(64),sha='a'.repeat(40),definition={key:'workflow_report.internal',version:'1.0.34',capability_id:'cap',activities:[{key:'report'}],source:{revision:sha}};
 const scope={scope:'commander-generic',manifest:{id:'map',digest,manifest:{scope_key:'commander-generic',value_streams:[{brain_binding:{source_revision:'b'.repeat(40)}}],capabilities:[]}},documents:[{definition,owner:{id:'w',version:'1.0.33'}}]};
 const deps={checkMain:async()=>calls.push('main'),task:async(key)=>{calls.push('task:'+key);return{id:key,status:'in_progress'};},verify:async()=>{calls.push('verify');return {evidence_refs:['artifact:real'],definition_sha256:digest};},complete:async(t)=>calls.push('complete:'+t.id),register:async()=>calls.push('register'),activate:async(s,body)=>{calls.push('activate');assert.deepEqual(body,{expected_active:{id:'map',digest}});},hash:()=>digest};
 await renewDefinitions([scope],{revision:sha,...deps});
 assert.ok(calls.indexOf('task:validation:workflow_report.internal')<calls.indexOf('verify'));
 assert.ok(calls.indexOf('verify')<calls.indexOf('register'));
 assert.equal(calls[calls.indexOf('register')-1],'main');assert.equal(calls[calls.indexOf('activate')-1],'main');
});
test('真实验证失败或主线漂移时不能register/activate或伪写PASS',async()=>{
 const {renewDefinitions}=await import('../authoring-main-source-core.mjs');
 for(const phase of ['verify','main']){
  let writes=0,n=0;const scope={scope:'commander-generic',documents:[{definition:{key:'x',activities:[]},owner:{}}]};
  await assert.rejects(renewDefinitions([scope],{revision:'a'.repeat(40),hash:()=>'',checkMain:async()=>{if(phase==='main'&&++n>1)throw Error('MAIN_MOVED');},task:async()=>({}),verify:async()=>{if(phase==='verify')throw Error('actual failure');return{definition_sha256:'',evidence_refs:['actual']};},complete:async()=>{},register:async()=>writes++,activate:async()=>writes++}));
  assert.equal(writes,0);
 }
});
test('生产写入CLI在非正式main环境先拒绝，不能误执行生产API',async()=>{
 const {runMainSource}=await import('../authoring-main-source.mjs');
 const old=process.env.GITHUB_REF;process.env.GITHUB_REF='refs/pull/1/merge';
 try{await assert.rejects(runMainSource(),/AUTHORING_FORMAL_MAIN_REQUIRED/);}finally{if(old===undefined)delete process.env.GITHUB_REF;else process.env.GITHUB_REF=old;}
});
test('task POST丢回执后只GET同身份任务，认领后读回；不会换source_id再POST',async()=>{
 const {createSourceTask}=await import('../authoring-main-source.mjs');
 let row=null,posts=0;const requests=[];
 const api=async(method,path,body)=>{
  requests.push([method,path]);
  if(method==='GET'&&path==='tasks?limit=1000')return row?[{id:'t',title:row.title}]:[];
  if(method==='GET'&&path==='tasks/t')return row;
  if(method==='POST'&&path==='tasks'){posts++;row={id:'t',title:body.title,payload:body.payload,status:body.status};throw Error('connection lost after commit');}
  if(method==='POST'&&path==='tasks/t/claim'){row={...row,claimed_by:body.claimer};return row;}
  throw Error('unexpected request');
 };
 const first=await createSourceTask(api,'a'.repeat(40),'validation:report');assert.equal(first.status,'in_progress');
 const second=await createSourceTask(api,'a'.repeat(40),'validation:report');assert.equal(second.id,'t');assert.equal(posts,1);
 assert.ok(requests.some(([m,p])=>m==='GET'&&p==='tasks/t'));
});
test('六阶段重放从实际state继续，严格同定义与最终登记读回',async()=>{
 const {submitSourceRegistration}=await import('../authoring-main-source.mjs');
 const definition={key:'report',version:'1.0.1',capability_id:'c',source:{revision:'a'.repeat(40)}},hash=()=> 'd'.repeat(64);
 const state={stage:'register',revision:5,outputs:{compose:{definition}},receipts:[]};let row={id:'t',status:'in_progress',result:{workflow_authoring:state}};
 const calls=[];const api=async(method,path,body)=>{
  calls.push([method,path,body]);
  if(method==='POST'&&path.endsWith('/submit')){assert.equal(body.stage,'register');state.stage='completed';state.outputs.register={readback_verified:true,workflow_id:'w',definition_sha256:hash(),version:'1.0.1'};state.receipts.push({submission_id:body.submission_id});throw Error('lost committed reply');}
  if(method==='GET'&&path.startsWith('workflow-authoring/'))return state;
  if(method==='PATCH'){row.status=body.status;row.result={...row.result,...body.result};return row;}
  if(method==='GET'&&path==='tasks/t')return row;
  throw Error('unexpected request');
 };
 await submitSourceRegistration(api,row,{definition,owner:{id:'w',version:'1.0.0'}},{id:'v',result:{workflow_validation:{evidence_refs:['actual']}}},hash);
 assert.equal(row.status,'completed');assert.equal(calls.filter(c=>c[0]==='POST').length,1);
});

test('真实L2聚合执行覆盖版头失败，tsconfig步骤不引用不存在needs',()=>{
 const w=YAML.parse(readFileSync(new URL('.github/workflows/ci-l2-consistency.yml',root),'utf8'));
 const ts=w.jobs['tsconfig-inheritance'].steps.find(s=>s.name==='Check apps inherit from base').run;
 assert.doesNotMatch(ts,/needs\.authoring-source-version/);
 const run=w.jobs['l2-passed'].steps[0].run;
 const shell=status=>run.replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g,(_,key)=>key==='authoring-source-version'?status:'success');
 execFileSync('bash',['-c',shell('success')],{stdio:'pipe'});
 assert.throws(()=>execFileSync('bash',['-c',shell('failure')],{stdio:'pipe'}));
});
test('六阶段中main漂移后不再submit，init未知响应只能读回同状态',async()=>{
 const {submitSourceRegistration}=await import('../authoring-main-source.mjs');
 const d={key:'r',version:'1.0.1',source:{revision:'a'.repeat(40)}};let moved=false,posts=0;
 const state={stage:'intake',revision:0,outputs:{},receipts:[]};
 const api=async(method,path)=>{if(method==='POST'&&path.endsWith('/init')){posts++;moved=true;throw Error('lost');}if(method==='GET'&&path.startsWith('workflow-authoring'))return state;throw Error('unexpected write');};
 await assert.rejects(submitSourceRegistration(api,{id:'t',result:{}},{definition:d,owner:{id:'w',version:'1.0.0'}},{id:'v',result:{workflow_validation:{evidence_refs:['actual']}}},()=> 'd'.repeat(64),async()=>{if(moved)throw Error('MAIN_MOVED');}),/MAIN_MOVED/);
 assert.equal(posts,1);
});
test('真实本地HTTP六阶段完整执行，写后断线GET恢复且同任务重跑不重注册',async()=>{
 const {createServer}=await import('node:http');
 const {createBrainApi,submitSourceRegistration}=await import('../authoring-main-source.mjs');
 const id='11111111-1111-4111-8111-111111111111',sha='a'.repeat(40),digest='d'.repeat(64);
 const definition={key:'r',version:'1.0.1',capability_id:id,source:{revision:sha}};
 const stages=['intake','reuse','compose','build','verify','register'];let registrations=0,cut=false;
 let state;const row={id,status:'in_progress',result:{}};
 const server=createServer(async(req,res)=>{
  let raw='';for await(const bytes of req)raw+=bytes;const body=raw?JSON.parse(raw):{};
  assert.equal(req.headers['x-internal-token'],'fixture-token');let result;
  if(req.method==='POST'&&req.url.endsWith('/init')){assert.equal(body.registration_protocol,'definition-freeze-v1');state={stage:'intake',revision:0,outputs:{},receipts:[]};result=state;}
  else if(req.method==='POST'&&req.url.endsWith('/submit')){
   assert.equal(body.stage,state.stage);assert.equal(body.revision,state.revision);
   state.outputs[body.stage]=body.output;state.receipts.push({submission_id:body.submission_id});state.revision++;
   if(body.stage==='register'){registrations++;state.outputs.register={readback_verified:true,workflow_id:id,definition_sha256:digest,version:definition.version};}
   state.stage=stages[state.revision]||'completed';row.result.workflow_authoring=state;
   if(body.stage==='compose'&&!cut){cut=true;req.socket.destroy();return;}result={state};
  }else if(req.method==='GET'&&req.url.includes('/workflow-authoring/'))result=state;
  else if(req.method==='PATCH'){row.status=body.status;row.result={...row.result,...body.result};result=row;}
  else if(req.method==='GET'&&req.url.endsWith(`/tasks/${id}`))result=row;
  else{res.writeHead(404);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const api=createBrainApi(`http://127.0.0.1:${server.address().port}`,'fixture-token');
  const item={definition,owner:{id,version:'1.0.0'}},validation={id,result:{workflow_validation:{evidence_refs:['artifact:actual']}}};
  await submitSourceRegistration(api,row,item,validation,()=>digest);
  assert.equal(row.status,'completed');assert.equal(registrations,1);assert.equal(cut,true);
  await submitSourceRegistration(api,row,item,validation,()=>digest);
  assert.equal(registrations,1);assert.equal(state.receipts.length,6);
 }finally{await new Promise(r=>server.close(r));}
});

test('正式main CLI真实Git origin预检接受checkout规范三形态，拒绝外源且不会调用生产API',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {runMainSource}=await import('../authoring-main-source.mjs');
 const directory=mkdtempSync(join(tmpdir(),'authoring-origin-preflight-'));
 const git=(root,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const make=(name,repo,files)=>{const root=join(directory,name);mkdirSync(root);git(root,'init','-q','-b','main');git(root,'config','user.email','fixture@example.invalid');git(root,'config','user.name','Fixture');git(root,'remote','add','origin',`https://github.com/${repo}`);for(const [p,body]of Object.entries(files)){const file=join(root,p);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,body);}git(root,'add','.');git(root,'commit','-qm','fixture');const sha=git(root,'rev-parse','HEAD');git(root,'update-ref','refs/remotes/origin/main',sha);return{root,sha};};
 const businessRepo='perfectuser21/zenithjoy-workspace',brainRepo='perfectuser21/cecelia';
 const business=make('business',businessRepo,{'fixture.txt':'business'});
 // Import sentinel is reached only after both actual remote/SHA checks and tooling ancestry.
 // It prevents API initialization or any source task creation in this real CLI entry test.
 const brain=make('brain',brainRepo,{'package.json':'{"type":"module"}','packages/brain/src/workflow-authoring/registration.js':"throw new Error('AUTHORING_FIXTURE_ORIGIN_PREFLIGHT_REACHED'); export const registrationDigest=()=>'';"});
 const environment={GITHUB_SHA:business.sha,AUTHORING_BRAIN_REVISION:brain.sha,GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:businessRepo,AUTHORING_ALLOW_WRITE:'1'};
 const prior=Object.fromEntries(Object.keys(environment).map(k=>[k,process.env[k]]));Object.assign(process.env,environment);
 const valid=repo=>[`https://github.com/${repo}`,`https://github.com/${repo}.git`,`git@github.com:${repo}.git`];
 const invalid=repo=>[`https://gitlab.com/${repo}.git`,`https://github.com.evil.invalid/${repo}.git`,`https://github.com/evil/${repo.split('/')[1]}.git`,`https://github.com/${repo}.git.evil`,`https://github.com/prefix${repo}`,`https://user:secret@github.com/${repo}.git`,`https://github.com/${repo}.git?ref=main`,`https://github.com/${repo}.git#main`,`git@evil.invalid:${repo}.git`,`git@github.com:${repo}.git?ref=main`,`https://github.com/${repo}/`];
 const run=()=>runMainSource({repoRoot:business.root,brainRoot:brain.root,output:join(directory,'must-not-write')});
 try{
  for(const origin of valid(businessRepo)){git(business.root,'remote','set-url','origin',origin);await assert.rejects(run(),/AUTHORING_FIXTURE_ORIGIN_PREFLIGHT_REACHED/);}
  git(business.root,'remote','set-url','origin',valid(businessRepo)[0]);
  for(const origin of valid(brainRepo)){git(brain.root,'remote','set-url','origin',origin);await assert.rejects(run(),/AUTHORING_FIXTURE_ORIGIN_PREFLIGHT_REACHED/);}
  git(brain.root,'remote','set-url','origin',valid(brainRepo)[0]);
  for(const origin of invalid(businessRepo)){git(business.root,'remote','set-url','origin',origin);await assert.rejects(run(),/AUTHORING_SOURCE_REPOSITORY_INVALID/);}
  git(business.root,'remote','set-url','origin',valid(businessRepo)[0]);
  for(const origin of invalid(brainRepo)){git(brain.root,'remote','set-url','origin',origin);await assert.rejects(run(),/AUTHORING_TOOLING_REPOSITORY_INVALID/);}
 }finally{for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}rmSync(directory,{recursive:true,force:true});}
});
