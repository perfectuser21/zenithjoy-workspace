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
 if(flow!=='douyin_comment_scoring')x.resources={machine:'us-mac-m4',profile:'cloud-phone-test',serial:'47.100.213.173:10001',line:'yuesheng',account:'77980009922'};
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
