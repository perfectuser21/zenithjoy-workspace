import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url);
const fixtureDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function scopeRecoveryFixture({sources=['a'.repeat(40),'b'.repeat(40)],revision='a'.repeat(40)}={}){
 const repo='perfectuser21/zenithjoy-workspace',scope='cecelia-device-patrol-definitions';
 const files=['contracts/single.json','contracts/batch.json'];
 const manifest={id:'map-active',manifest:{scope_key:scope,value_streams:[],capabilities:sources.map((_,i)=>({key:`cap-${i}`,brain_binding:{entity_type:'capability',entity_id:`cap-${i}`,source_repo:repo,source_revision:'b'.repeat(40)}}))}};
 manifest.digest=fixtureDigest(manifest.manifest);
 const owners=sources.map((source,i)=>({id:`owner-${i}`,key:`workflow-${i}`,version:source===revision?'1.0.2':'1.0.1',current_definition_version_id:`version-${i}`,capability_id:`cap-${i}`}));
 const versions=owners.map((owner,i)=>({id:owner.current_definition_version_id,workflow_id:owner.id,source_repo:repo,source_path:files[i],source_commit:sources[i],payload:{registration_protocol:'definition-freeze-v1',contract:{key:owner.key,capability_id:owner.capability_id,version:owner.version}}}));
 const snapshots=new Map([...new Set(sources)].map(source=>{
  // Native snapshot selects every historical definition at the requested source.
  // Once single advances, the old full-scope selection is no longer all-current.
  const historical=source==='b'.repeat(40)&&sources.some(s=>s!==source);
  const selected=historical?versions.map((v,i)=>({...v,id:sources[i]===source?v.id:`historical-${i}`,source_commit:source})):versions.filter(v=>v.source_commit===source);
  const present=!historical;
  const snapshot={scope,repo,revision:source,definitions:{workflows:selected},canonical:{workflows:owners,journeys:owners.map(o=>({id:o.capability_id,parent_journey_id:'journey'}))},map:{manifest:present?manifest:null},
   gaps:present?(sources.some(s=>s!==source)?[{code:'authoring_definition_missing',key:'workflow-1'},{code:'manifest_source_mismatch',revision:source}]:[]):[{code:'scope_manifest_missing',scope,revision:source},{code:'workflow_capability_unmapped',capability_id:'cap-1'}]};
  snapshot.snapshot_sha256=fixtureDigest(snapshot);return[source,snapshot];
 }));
 const calls=[],active={manifest_version_id:manifest.id,manifest_digest:manifest.digest};
 const api=async(method,path)=>{
  calls.push([method,path]);assert.equal(method,'GET','source planning must never write');
  if(path.startsWith('workflows/'))return{version:versions.find(v=>path===`workflows/${v.workflow_id}/versions/${v.id}`)};
  if(path.startsWith('implementation-ci/snapshot?'))return{snapshot:snapshots.get(new URLSearchParams(path.split('?')[1]).get('revision'))};
  if(path===`map?scope=${scope}`)return active;
  throw Error(`unexpected ${path}`);
 };
 const readDefinition=path=>{const i=files.indexOf(path);return{key:owners[i].key,version:'1.0.2',capability_id:owners[i].capability_id,runtime:{skill_id:'skill'},activities:[],source:{repo,ref:path,revision}};};
 const validateSnapshot=s=>{const{snapshot_sha256,...body}=s;assert.equal(snapshot_sha256,fixtureDigest(body),'original native snapshot must remain unmodified');};
 const reseal=()=>{for(const s of snapshots.values()){delete s.snapshot_sha256;s.snapshot_sha256=fixtureDigest(s);}};
 return{args:{api,scope,files,revision,repo,owners,skills:[],readDefinition,validateSnapshot,digestMapManifest:fixtureDigest},snapshots,versions,owners,manifest,active,calls,reseal};
}

for(const[state,sources,revision]of[
 ['全新candidate',['b','b'],'a'],['全scope已登记',['a','a'],'a'],['同SHA部分登记恢复',['a','b'],'a'],['部分登记后下一candidate',['a','b'],'c'],
]){
 test(`来源规划${state}：scope固定真实active地图，每个owner保留原生snapshot`,async()=>{
  const {loadAuthoringScope}=await import('../authoring-main-source.mjs');
  const f=scopeRecoveryFixture({sources:sources.map(s=>s.repeat(40)),revision:revision.repeat(40)});
  const before=[...f.snapshots.values()].map(s=>JSON.stringify(s));
  const loaded=await loadAuthoringScope(f.args);
  assert.equal(loaded.manifest,f.manifest);
  for(const[item,i]of loaded.documents.map((item,i)=>[item,i])){
   assert.equal(item.snapshot,f.snapshots.get(f.versions[i].source_commit));
   assert.equal(item.owner,f.owners[i]);
  }
  assert.deepEqual([...f.snapshots.values()].map(s=>JSON.stringify(s)),before);
  assert.equal(f.calls.filter(([,path])=>path===`map?scope=${f.args.scope}`).length,2,'anchor must be read before and after planning');
 });
}
for(const[reason,mutate,expected]of[
 ['无完整来源地图',f=>{for(const s of f.snapshots.values()){s.map.manifest=null;s.gaps=[{code:'scope_manifest_missing',scope:f.args.scope,revision:s.revision}];}},/COMPLETE_MANIFEST/],
 ['地图摘要错误',f=>{f.manifest.digest='0'.repeat(64);},/MANIFEST/],
 ['地图不是active',f=>{f.active.manifest_version_id='other';},/MAP_ACTIVE_CHANGED/],
 ['旧owner来源错误',f=>{f.versions[1].source_repo='evil/repo';},/OWNER_SOURCE/],
 ['旧owner冻结seed缺失',f=>{f.snapshots.get('b'.repeat(40)).definitions.workflows=[];},/OWNER_SNAPSHOT/],
 ['地图不能证明owner能力',f=>{f.manifest.manifest.capabilities.pop();f.manifest.digest=fixtureDigest(f.manifest.manifest);f.active.manifest_digest=f.manifest.digest;},/CAPABILITY/],
 ['地图能力属于外仓',f=>{f.manifest.manifest.capabilities[1].brain_binding.source_repo='evil/repo';f.manifest.digest=fixtureDigest(f.manifest.manifest);f.active.manifest_digest=f.manifest.digest;},/CAPABILITY/],
 ['未知gap',f=>{f.snapshots.get('b'.repeat(40)).gaps.push({code:'definition_snapshot_ambiguous'});},/BASE_SNAPSHOT/],
 ['伪造missing-map范围',f=>{f.snapshots.get('b'.repeat(40)).gaps[0].scope='other';},/BASE_SNAPSHOT/],
 ['无法证明的unmapped能力',f=>{f.snapshots.get('b'.repeat(40)).gaps[1].capability_id='other';},/CAPABILITY/],
]){
 test(`来源恢复仍拒绝：${reason}`,async()=>{
  const{loadAuthoringScope}=await import('../authoring-main-source.mjs');const f=scopeRecoveryFixture();mutate(f);f.reseal();
  await assert.rejects(loadAuthoringScope(f.args),expected);
 });
}
test('来源恢复读取期间active地图并发变化必须拒绝',async()=>{
 const{loadAuthoringScope}=await import('../authoring-main-source.mjs');const f=scopeRecoveryFixture();const base=f.args.api;let reads=0;
 f.args.api=async(method,path)=>{const result=await base(method,path);return path===`map?scope=${f.args.scope}`&&++reads>1?{...result,manifest_digest:'0'.repeat(64)}:result;};
 await assert.rejects(loadAuthoringScope(f.args),/MAP_ACTIVE_CHANGED/);
});
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
 const invalid=repo=>[`https://gitlab.com/${repo}.git`,`https://github.com.evil.invalid/${repo}.git`,`https://github.com/evil/${repo.split('/')[1]}.git`,`https://github.com/${repo}.git.evil`,`https://github.com/prefix${repo}`,`https://user:secret@github.com/${repo}.git`,`https://github.com/${repo}.git?ref=main`,`https://github.com/${repo}.git#main`,`git@evil.invalid:${repo}.git`,`git@github.com:${repo}.git?ref=main`,`https://github.com/${repo}/`,` https://github.com/${repo}`,`https://github.com/${repo} `];
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
