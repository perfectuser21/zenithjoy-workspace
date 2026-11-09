import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const source=new URL('../public-domain-profile.mjs',import.meta.url);
test('public profile builder exists as a product entry rather than handwritten runtime configuration',async()=>{
 assert.ok(existsSync(source),'release/frozen public profile builder missing');
 const module=await import(source.href);assert.equal(typeof module.buildPublicDomainProfile,'function');
});
test('profile builder rejects missing original deployment and formal identities',async()=>{
 assert.ok(existsSync(source),'release/frozen public profile builder missing');
 const {buildPublicDomainProfile}=await import(source.href);
 assert.throws(()=>buildPublicDomainProfile({}),/PUBLIC_DOMAIN_PROFILE_/);
});

import {mkdtempSync,writeFileSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../runtime-definition.mjs';
import {installPreflightPg,preflightPgDeployment} from '../preflight-pg-dependencies.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sha='a'.repeat(40);
const version=(id,payload,extra={})=>{const v={id:uuid(id),source_repo:'perfectuser21/zenithjoy-workspace',source_path:'product-map/contracts/test.yaml',source_commit:sha,payload,...extra};v.payload_sha256=digest({source:{repo:v.source_repo,path:v.source_path,commit:sha},payload});return v;};
async function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'public-profile-')));
 await installPreflightPg({runtimeRoot:root,sourceCommit:sha});
 const names={'leadgen-public-domain.mjs':'export const fixed=1;','public-domain-authority.mjs':'export const authority=1;','public-domain-pg.mjs':'export const pool=1;','skills/runner-commander/SKILL.md':'---\nversion: 1.1.0\n---\n固定Commander','plans/douyin_comment_scoring.steps.json':'{}'};
 for(const [name,text]of Object.entries(names)){mkdirSync(join(root,name,'..'),{recursive:true});writeFileSync(join(root,name),text,{mode:0o600});}
 const av=version(3,{activity_id:uuid(4),contract:{key:'scoring',version:'1.2.3',promise:'原评分政策',preconditions:['原评论已提交'],inputs:['Comment'],outputs:['Score'],postconditions:['原政策持久化读回'],failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},budget:{max_duration_s:90,heartbeat_s:10},runtime:{phase:'source',entry:'original.mjs'}},steps:[],implementation_bindings:[]},{activity_id:uuid(4)});
 const ref={reference_id:uuid(5),activity_id:uuid(4),activity_version_id:uuid(3),slot_key:'scoring',sequence_no:1};
 const resources={machine:'us-mac-m4',profile:'mmv-scoring',serial:'none',line:'yuesheng',account:'none'};
 const w=version(1,{key:'douyin_comment_scoring',workflow_id:uuid(2),activities:[ref],contract:{resources,input_schema:{type:'object'},recovery:{total_timeout_sec:90,cleanup_timeout_sec:20}}},{workflow_id:uuid(2)});
 const release={id:uuid(6),target:'mmv',environment:'staging:'+sha,payload:{components:[{kind:'repo',repo:'perfectuser21/zenithjoy-workspace',revision:sha}],workflows:[w],activities:[av]}};
 release.manifest_sha256=digest({target:release.target,environment:release.environment,payload:release.payload});
 const pg=preflightPgDeployment({runtimeRoot:root,sourceCommit:sha});
 const deployment={release_id:release.id,observation_id:uuid(7),source_commit:sha,target:'mmv',environment:release.environment,files:[...Object.entries(names).map(([deployed_path,text])=>({deployed_path,content_sha256:digest(text)})),{deployed_path:'preflight-pg-lock.json',content_sha256:digest(readFileSync(join(root,'preflight-pg-lock.json')))}],dependencies:{preflight_pg:pg}};
 const manifest=JSON.stringify(deployment);writeFileSync(join(root,'deployment-manifest.json'),manifest,{mode:0o600});
 const frozen={release,deployment,workflow_version:w,activities:[{reference:ref,version:av}],files:{'runtime/deployment-manifest.json':digest(manifest)}};frozen.snapshot_sha256=digest(frozen);
 return {sourceRoot:root,frozen,observation:{id:uuid(7),release_id:release.id,payload:{environment:release.environment,target:'mmv',components:release.payload.components}},gate:{deployed:true,actual_matches:true,current_observation_id:uuid(7),gaps:[]},resources,company:{company_id:uuid(8),tenant_id:uuid(9),version:26,policy_id:'original-v26'},profileId:'cloud-103',commander:{kind:'openclaw',skill:{entry:'skills/runner-commander/SKILL.md',version:'1.1.0'},timeout_s:30},env:{P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'upstream102',WFR_TAG:'current103',LEADGEN_LIMIT:'1'}};
}
test('assembles formal source identity and original budgets with offline verified fourteen-package PG closure',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),input=await fixture();
 try{
  const before=digest(input.frozen),out=buildPublicDomainProfile(input),p=out.profile;
  assert.equal(digest(input.frozen),before);assert.equal(out.profile_sha256,digest(p));
  assert.equal(p.metadata.scoring.identity.reference_id,uuid(5));assert.equal(p.metadata.scoring.identity.activity_definition_version_id,uuid(3));
  assert.equal(p.preconditions.scoring.acceptance.ref,p.metadata.scoring.questions.A2.ref);assert.equal(p.validators.scoring.acceptance.ref,p.metadata.scoring.questions.A4.ref);
  assert.deepEqual(p.contract.activities[0].budget,{max_duration_s:90,heartbeat_s:10});
  assert.equal(p.domain_adapter.budget.max_duration_s,70);assert.equal(p.domain_adapter.budget.cleanup_grace_s,20);
  assert.equal(p.cleanup_required,false);assert.deepEqual(p.resources,[]);
  assert.equal(out.definition.release_id,uuid(6));assert.equal(out.definition.workflow_definition_version_id,uuid(1));assert.equal(out.route.machine_id,'us-mac-m4');assert.deepEqual(out.brain_profiles,{profiles:{'cloud-103':{machine_id:'us-mac-m4',profile_sha256:out.profile_sha256}}});
  const noPolicy=structuredClone(input);delete noPolicy.frozen.workflow_version.payload.contract.recovery;const w=noPolicy.frozen.workflow_version;w.payload_sha256=digest({source:{repo:w.source_repo,path:w.source_path,commit:w.source_commit},payload:w.payload});noPolicy.frozen.release.payload.workflows=[w];const r=noPolicy.frozen.release;r.manifest_sha256=digest({target:r.target,environment:r.environment,payload:r.payload});delete noPolicy.frozen.snapshot_sha256;noPolicy.frozen.snapshot_sha256=digest(noPolicy.frozen);const b=buildPublicDomainProfile(noPolicy).profile.domain_adapter.budget;assert.ok(b.max_duration_s+b.cleanup_grace_s<=90,'no source budget can be enlarged to reserve close time');
  assert.equal(Object.values(p.files).every(v=>/^[a-f0-9]{64}$/.test(v)),true);assert.ok(Object.keys(p.files).some(k=>k.includes('_dependencies/preflight-pg/node_modules/pg/')));
  const cases=[x=>x.gate.current_observation_id=uuid(999),x=>x.observation.payload.components=[],x=>x.company.version=0,x=>x.commander.skill.version='9.9.9'];
  for(const change of cases){const x=structuredClone(input);change(x);assert.throws(()=>buildPublicDomainProfile(x),/PUBLIC_DOMAIN_PROFILE_/);}
  const tampered=structuredClone(input);tampered.frozen.activities[0].version.payload.contract.budget.max_duration_s=3601;delete tampered.frozen.snapshot_sha256;tampered.frozen.snapshot_sha256=digest(tampered.frozen);
  assert.throws(()=>buildPublicDomainProfile(tampered),/PUBLIC_DOMAIN_PROFILE_/);
  writeFileSync(join(input.sourceRoot,'_dependencies/preflight-pg/node_modules/pg/package.json'),'{}',{mode:0o600});
  assert.throws(()=>buildPublicDomainProfile(input),/PREFLIGHT_PG_/);
 }finally{rmSync(input.sourceRoot,{recursive:true,force:true});}
});


import {parseActivityContract} from '../common-runner/activity-contract.js';
// Shapes independently read from the real 1255614a release; fixture identities
// remain deterministic test identities and never stand in for a real ACK.
const original125Shapes={
 douyin_video_discovery:[['preflight','setup',300,60],['collect_videos','source',2400,60],['cleanup','finalize',120,30]],
 douyin_video_processing:[['preflight','setup',300,60],['dedup','batch_end',600,60],['qualification','per_item',1800,60],['collection','per_item',7200,300],['cleanup','finalize',120,30]],
 douyin_comment_scoring:[['scoring','batch_end',1800,120],['mark_leads','batch_end',1800,120]],
};
function sign(v){v.payload_sha256=digest({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});}
function reseal(x){
 const f=x.frozen,r=f.release;r.manifest_sha256=digest({target:r.target,environment:r.environment,payload:r.payload});
 const raw=JSON.stringify(f.deployment);writeFileSync(join(x.sourceRoot,'deployment-manifest.json'),raw,{mode:0o600});f.files['runtime/deployment-manifest.json']=digest(raw);
 delete f.snapshot_sha256;f.snapshot_sha256=digest(f);
}
function originalShape(x,flow){
 const f=x.frozen,w=f.workflow_version,prototype=structuredClone(f.activities[0].version);
 w.payload.key=flow;delete w.payload.contract.recovery;
 f.activities=original125Shapes[flow].map(([key,phase,max_duration_s,heartbeat_s],i)=>{
  const av=structuredClone(prototype);av.id=uuid(100+i);av.activity_id=uuid(200+i);av.payload.activity_id=av.activity_id;
  const c=av.payload.contract;c.key=key;c.order=i+1;c.budget={max_duration_s,heartbeat_s};
  c.runtime={phase,entry:'leadgen-activity.sh',args:'WORKFLOW_KEY ACTIVITY_KEY PROFILE SERIAL LINE RUN_TAG'};sign(av);
  const reference={reference_id:uuid(300+i),activity_id:av.activity_id,activity_version_id:av.id,slot_key:key,sequence_no:i+1};
  return {reference,version:av};
 });
 w.payload.activities=f.activities.map(a=>a.reference);sign(w);f.release.payload.workflows=[w];f.release.payload.activities=f.activities.map(a=>a.version);
 const step='plans/'+flow+'.steps.json';writeFileSync(join(x.sourceRoot,step),'{}',{mode:0o600});
 if(!f.deployment.files.some(row=>row.deployed_path===step))f.deployment.files.push({deployed_path:step,content_sha256:digest('{}')});
 if(flow!=='douyin_comment_scoring'){
  x.resources={machine:'us-mac-m4',profile:'cloud-phone-test',serial:'47.100.213.173:10001',line:'yuesheng',account:'77980009922'};
  const registry=join(x.sourceRoot,'profiles.tsv');writeFileSync(registry,'profile\tserial\tmodel\twidth\theight\tenabled\ncloud-phone-test\t47.100.213.173:10001\tFixture\t720\t1280\ttrue\n',{mode:0o600});x.env.DOUYIN_PHONE_REGISTRY=registry;
 }
 reseal(x);return x;
}
for(const flow of Object.keys(original125Shapes))test('real '+flow+' AV shapes compile through the public contract parser without inventing foreach bindings',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=originalShape(await fixture(),flow);
 try{
  const original=structuredClone(x.frozen.activities),p=buildPublicDomainProfile(x).profile;
  const parsed=parseActivityContract(p.contract);
  assert.equal(parsed.activities.length,original.length);
  for(let i=0;i<original.length;i++){
   const sourceContract=original[i].version.payload.contract,a=parsed.activities[i];
   assert.equal(a.runtime.protocol,'json-stdio-v1');
   assert.equal(a.runtime.phase,sourceContract.runtime.phase==='finalize'?'finalize':'source');
   assert.equal(a.runtime.per_item,undefined,'whole-batch native handlers own their original iteration');
   assert.deepEqual(a.budget,sourceContract.budget,'including collection 7200s must not be silently cut');
   assert.deepEqual(p.domain_adapter.config.snapshot.activities[i],original[i],'original AV and declared business contract remain immutable');
  }
  const b=p.domain_adapter.budget,total=original.reduce((n,a)=>n+a.version.payload.contract.budget.max_duration_s,0);
  assert.ok(b.max_duration_s+b.cleanup_grace_s<=total);
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});
test('workflow total timeout includes reserved cleanup rather than adding cleanup to the total',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=await fixture();
 try{const p=buildPublicDomainProfile(x).profile,b=p.domain_adapter.budget;
  assert.ok(b.max_duration_s+b.cleanup_grace_s<=90,'source recovery total is 90s including the original 20s cleanup reserve');
  assert.equal(b.cleanup_grace_s,20);assert.equal(b.max_duration_s,70);
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

test('all Activity recorder metadata carries the exact source inventory digest declared in the internal run binding',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=originalShape(await fixture(),'douyin_video_processing');
 try{
  const out=buildPublicDomainProfile(x),expected=digest(out.profile.files);
  assert.equal(out.definition.runtime_snapshot_sha256,expected);
  for(const [key,m]of Object.entries(out.profile.metadata))assert.equal(m.runtime_snapshot_sha256,expected,key+' must satisfy the original Brain span provenance binding');
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

test('workflow cleanup scope shares the original cleanup Activity A4 acceptance instead of overwriting its validator',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=originalShape(await fixture(),'douyin_video_discovery');
 try{
  const p=buildPublicDomainProfile(x).profile;
  assert.equal(p.validators.cleanup.acceptance.ref,p.metadata.cleanup.questions.A4.ref,'validateActivity and validateWorkflow use this same cleanup key');
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

for(const flow of ['douyin_video_discovery','douyin_video_processing'])test(flow+' public profile freezes real registry bytes/model/dimensions for shared Code preflight',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=originalShape(await fixture(),flow);
 try{
  const p=buildPublicDomainProfile(x).profile,fixed=p.domain_adapter.config.snapshot.preflight_profile;
  assert.deepEqual(fixed,{schema_version:1,path:x.env.DOUYIN_PHONE_REGISTRY,sha256:digest(readFileSync(x.env.DOUYIN_PHONE_REGISTRY)),profile:x.resources.profile,serial:x.resources.serial,model:'Fixture',width:720,height:1280,enabled:true});
  writeFileSync(x.env.DOUYIN_PHONE_REGISTRY,'profile\tserial\tmodel\twidth\theight\tenabled\ncloud-phone-test\tOTHER\tFixture\t720\t1280\ttrue\n');
  assert.throws(()=>buildPublicDomainProfile(x),/PREFLIGHT_PROFILE_INVALID/);
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

for(const flow of ['douyin_video_discovery','douyin_video_processing'])test(flow+' derives whole-run ADB environment from frozen declared instance instead of stale assembly env',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),{freezePublicPreflightRoute}=await import('../public-preflight-route.mjs'),x=originalShape(await fixture(),flow);
 try{
  const policy={schema_version:2,instance_id:'mmv-cloud-epoch2',host_id:'mmv',transport:'tcp',endpoint:'tcp:127.0.0.1:5042',forbidden_ports:[],adb_bin:'/fixed/adb',adb_realpath:'/fixed/adb',adb_sha256:'a'.repeat(64)},privatePath=join(x.sourceRoot,'epoch2.json');
  writeFileSync(privatePath,JSON.stringify(policy),{mode:0o600});mkdirSync(join(x.sourceRoot,'config'),{recursive:true});const relative='config/adb-host-instances.json';
  const raw=JSON.stringify({schema_version:1,instances:[{instance_id:policy.instance_id,kind:'managed',policy_path:privatePath,policy,coexists_with:['legacy']}]});writeFileSync(join(x.sourceRoot,relative),raw);
  x.frozen.deployment.files.push({path:'services/phone-adb-controller/'+relative,deployed_path:relative,content_sha256:digest(raw)});
  const scope={target:'mmv',profile:x.resources.profile,serial:x.resources.serial,expected_account:x.resources.account,policy};scope.policy_binding=freezePublicPreflightRoute({root:x.sourceRoot,files:{[relative]:digest(raw)},scope});
  x.frozen[flow==='douyin_video_discovery'?'discovery_phone_scope':'collection_phone_scope']=scope;Object.assign(x.env,{DOUYIN_ADB_PORT:'5041',ADB_SERVER_SOCKET:'tcp:127.0.0.1:5041',ZJ_ADB_HOST_CONFIG:'/request-must-not-select-policy'});reseal(x);
  const p=buildPublicDomainProfile(x).profile,cfg=p.domain_adapter.config;
  assert.equal(cfg.env.DOUYIN_ADB_PORT,'5042');assert.equal(cfg.env.ADB_SERVER_SOCKET,policy.endpoint);assert.equal(cfg.env.ZJ_ADB_HOST_CONFIG,undefined);
  assert.deepEqual(cfg.snapshot.public_preflight_route,scope.policy_binding);assert.deepEqual(cfg.snapshot[flow==='douyin_video_discovery'?'discovery_phone_scope':'collection_phone_scope'].policy,policy);assert.equal(x.env.DOUYIN_ADB_PORT,'5041','builder does not mutate caller assembly input');
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

// Only source packaging is exercised: synthetic definition IDs issue no grant,
// epoch record, ACK or device operation. Every E dependency is real fixed Git bytes.
test('official builder and public snapshot preserve the real epoch closure in per-run runtime',async()=>{
 const {reviewSource}=await import('../device-epoch-fence-review.mjs');
 const {preparePublicDomainSnapshot}=await import('../public-domain-snapshot.mjs');
 const {pathToFileURL}=await import('node:url');
 const actual=reviewSource(),input=await fixture();
 try{
  rmSync(join(input.sourceRoot,'_dependencies'),{recursive:true,force:true});
  await installPreflightPg({runtimeRoot:input.sourceRoot,sourceCommit:actual.commit});
  const names=new Set([...input.frozen.deployment.files.map(r=>r.deployed_path),...Object.keys(actual.files).map(p=>p.slice('services/phone-adb-controller/'.length))]);
  for(const name of names){const path=new URL('../'+name,import.meta.url);if(!existsSync(path))continue;mkdirSync(join(input.sourceRoot,name,'..'),{recursive:true});writeFileSync(join(input.sourceRoot,name),readFileSync(path),{mode:0o600});}
  const f=input.frozen;for(const v of [f.workflow_version,...f.activities.map(a=>a.version)]){v.source_commit=actual.commit;v.payload_sha256=digest({source:{repo:v.source_repo,path:v.source_path,commit:actual.commit},payload:v.payload});}
  f.release.environment='staging:'+actual.commit;f.release.payload.components[0].revision=actual.commit;
  Object.assign(f.deployment,{source_repo:'perfectuser21/zenithjoy-workspace',source_commit:actual.commit,environment:f.release.environment,files:[...names].map(name=>({path:'services/phone-adb-controller/'+name,deployed_path:name,content_sha256:digest(readFileSync(join(input.sourceRoot,name)))})),dependencies:{preflight_pg:preflightPgDeployment({runtimeRoot:input.sourceRoot,sourceCommit:actual.commit})}});
  input.observation.payload.environment=f.release.environment;input.observation.payload.components=f.release.payload.components;reseal(input);
  const {profile}= (await import('../public-domain-profile.mjs')).buildPublicDomainProfile(input);
  const identity={run_id:uuid(900),task_id:uuid(901),machine_id:'us-mac-m4',profile_sha256:digest(profile),input:{upstream:{run_id:uuid(902),task_id:uuid(903),run_directory:'/fixture/upstream',profile_sha256:'b'.repeat(64)}},run_binding:{workflow_id:f.workflow_version.payload.workflow_id,workflow_definition_version_id:f.workflow_version.id,activities:Object.fromEntries(f.activities.map(a=>[a.reference.slot_key,{reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id}]))}};
  const prepared=preparePublicDomainSnapshot({identity,profile,runDirectory:join(input.sourceRoot,'isolated-run'),deadline_ms:Date.now()+70000,cleanup_deadline_ms:Date.now()+90000});
  const loaded=await import(pathToFileURL(join(prepared.runtime,'device-epoch-fence-review.mjs')));
  const proof=loaded.reviewSource({runtimeRoot:prepared.runtime,repositoryRoot:'/no-git'});
  assert.equal(proof.commit,actual.commit);assert.deepEqual(proof.files,actual.files);
  const mf=JSON.parse(readFileSync(join(prepared.runtime,'deployment-manifest.json')));
  for(const [name,hash] of Object.entries(actual.files)){const row=mf.files.find(r=>r.path===name);assert.ok(row,name);assert.equal(row.content_sha256,hash);assert.equal(digest(readFileSync(join(prepared.runtime,row.deployed_path))),hash);}
 }finally{rmSync(input.sourceRoot,{recursive:true,force:true});}
});

for(const [phone,serial,account] of [['xiaolongxia','ANGYVB4311010223','90915521618'],['yueshengyun-work','e6c7ef34','37358506855']])test('formal xian-mac-m4 builder preserves released USB scope '+phone,async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=originalShape(await fixture(),'douyin_video_discovery');
 try{
  const relative='config/collection-phone-hosts.json',raw=readFileSync(new URL('../'+relative,import.meta.url)),row=JSON.parse(raw).hosts.find(h=>h.profile===phone);
  mkdirSync(join(x.sourceRoot,'config'),{recursive:true});writeFileSync(join(x.sourceRoot,relative),raw,{mode:0o600});
  x.frozen.deployment.files.push({deployed_path:relative,content_sha256:digest(raw)});
  x.resources={machine:'xian-mac-m4',profile:phone,serial,line:'yuesheng',account};
  x.frozen.deployment.target=x.frozen.release.target=x.observation.payload.target='xian-m4';
  x.frozen.discovery_phone_scope=structuredClone(row);
  writeFileSync(x.env.DOUYIN_PHONE_REGISTRY,'profile\tserial\tmodel\twidth\theight\tenabled\n'+phone+'\t'+serial+'\tFixture\t720\t1280\ttrue\n');reseal(x);
  const {profile}=buildPublicDomainProfile(x),cfg=profile.domain_adapter.config;
  assert.equal(cfg.resources.machine,'xian-mac-m4');assert.equal(cfg.env.DOUYIN_ADB_PORT,'5037');assert.equal(cfg.env.ADB_SERVER_SOCKET,row.policy.endpoint);assert.equal(cfg.env.LEADGEN_MMV_DEVICE_RUNTIME,undefined);
  const {preparePublicDomainSnapshot}=await import('../public-domain-snapshot.mjs'),f=x.frozen;
  const identity={run_id:uuid(920),task_id:uuid(921),machine_id:'xian-mac-m4',profile_sha256:digest(profile),input:{},run_binding:{workflow_id:f.workflow_version.payload.workflow_id,workflow_definition_version_id:f.workflow_version.id,activities:Object.fromEntries(f.activities.map(a=>[a.reference.slot_key,{reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id}]))}};
  Object.assign(cfg.env,{P:phone,SERIAL:serial});identity.profile_sha256=digest(profile);
  const prepared=preparePublicDomainSnapshot({identity,profile,runDirectory:join(x.sourceRoot,'usb-run'),deadline_ms:Date.now()+70000,cleanup_deadline_ms:Date.now()+90000});assert.equal(prepared.env.WFR_HOSTKEY,'xian-m4');assert.equal(prepared.env.DOUYIN_ADB_PORT,'5037');assert.equal(prepared.snapshot.discovery_phone_scope.expected_account,account);
  for(const change of [y=>y.resources.account='borrowed',y=>y.frozen.discovery_phone_scope.policy.endpoint='tcp:127.0.0.1:5041',y=>y.resources.machine='us-mac-m4']){const y=structuredClone(x);change(y);reseal(y);assert.throws(()=>buildPublicDomainProfile(y),/PUBLIC_DOMAIN_PROFILE_/);}
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

test('103 public preparation consumes committed queue without a parent run',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),{preparePublicDomainSnapshot}=await import('../public-domain-snapshot.mjs'),x=await fixture();
 try{
  delete x.env.LEADGEN_SOURCE_RUN;const {profile}=buildPublicDomainProfile(x),f=x.frozen;
  const identity={run_id:uuid(910),task_id:uuid(911),machine_id:'us-mac-m4',profile_sha256:digest(profile),input:{},run_binding:{workflow_id:f.workflow_version.payload.workflow_id,workflow_definition_version_id:f.workflow_version.id,activities:Object.fromEntries(f.activities.map(a=>[a.reference.slot_key,{reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id}]))}};
  const args={identity,profile,runDirectory:join(x.sourceRoot,'queue-run'),deadline_ms:Date.now()+70000,cleanup_deadline_ms:Date.now()+90000};
  const result=preparePublicDomainSnapshot(args);assert.equal(result.env.LEADGEN_SOURCE_RUN,undefined);assert.equal(result.snapshot.public_domain.upstream,undefined);
  identity.input={source_run:'partial102'};assert.throws(()=>preparePublicDomainSnapshot({...args,runDirectory:join(x.sourceRoot,'bad-run')}),/PUBLIC_DOMAIN_UPSTREAM/);
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});

test('agent-first public metadata binds a verified business Skill and rejects an unverified or code-only method',async()=>{
 const {buildPublicDomainProfile}=await import(source.href),x=await fixture();
 try{
  const path='skills/douyin-leadgen-activity-103-scoring/SKILL.md',text='---\nname: douyin-leadgen-activity-103-scoring\nmetadata:\n  version: 0.12.0\n  primary_execution: agent-v1\n  execution_transport: raw-model-v1\n  primary_hosts: [official-child-v1]\n---\n原评分政策';
  mkdirSync(join(x.sourceRoot,path,'..'),{recursive:true});writeFileSync(join(x.sourceRoot,path),text,{mode:0o600});
  const f=x.frozen,a=f.activities[0],b={kind:'skill',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:sha,path:'services/phone-adb-controller/'+path,name:'douyin-leadgen-activity-103-scoring',version:'0.12.0',content_sha256:digest(text)};
  a.version.payload.implementation_bindings=[b];sign(a.version);a.implementations=[{...b,execution_verification:'verified_local',actual_content_sha256:digest(text),execution_path:'runtime/'+path}];
  f.execution_mode='agent';f.execution_transport='raw-model-v1';f.max_turns=12;f.deployment.files.push({deployed_path:path,content_sha256:digest(text)});reseal(x);
  const p=buildPublicDomainProfile(x).profile;
  const offline=structuredClone(x);delete offline.frozen.execution_mode;delete offline.frozen.execution_transport;delete offline.frozen.max_turns;delete offline.frozen.snapshot_sha256;offline.frozen.snapshot_sha256=digest(offline.frozen);
  const planned=buildPublicDomainProfile({...offline,primaryHost:'official-child-v1'}).profile;assert.equal(planned.metadata.scoring.executor_kind,'agent');assert.equal(planned.domain_adapter.config.primary_host,'official-child-v1');assert.equal(planned.domain_adapter.config.snapshot.execution_mode,'agent');assert.equal(planned.domain_adapter.config.snapshot.agent_input,undefined);
  assert.equal(p.metadata.scoring.executor_kind,'agent');assert.deepEqual(p.metadata.scoring.skill,{entry:path,version:'0.12.0'});
  assert.equal(p.metadata.scoring.implementation.kind,'agent');assert.equal(p.domain_adapter.config.execution_mode,'agent');
  const bad=structuredClone(x);bad.frozen.activities[0].implementations[0].execution_verification='unknown';delete bad.frozen.snapshot_sha256;bad.frozen.snapshot_sha256=digest(bad.frozen);
  assert.throws(()=>buildPublicDomainProfile(bad),/SKILL/);
 }finally{rmSync(x.sourceRoot,{recursive:true,force:true});}
});
