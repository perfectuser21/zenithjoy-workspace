// Offline assembly only. The dispatcher creates the first internal binding;
// this builder never starts a run, writes Brain, creates grants or issues ACKs.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {digest,canonical} from './runtime-definition.mjs';
import {preflightPgDeployment,preflightPgLockIdentity} from './preflight-pg-dependencies.mjs';
import {freezePreflightProfile} from './preflight-control-scope.mjs';
import {freezePublicPreflightRoute} from './public-preflight-route.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const need=(ok,reason)=>{if(!ok)throw Error('PUBLIC_DOMAIN_PROFILE_'+reason);};
const same=(a,b)=>canonical(a)===canonical(b);
const safe=p=>typeof p==='string'&&!isAbsolute(p)&&p.split('/').every(v=>v&&v!=='.'&&v!=='..');
const versionDigest=v=>digest({source:{repo:v.source_repo,path:v.source_path,commit:v.source_commit},payload:v.payload});
const clone=v=>structuredClone(v);
function file(root,name,expected){
 need(safe(name)&&HASH.test(expected),'FILE_PATH');const path=join(root,name),stat=lstatSync(path);
 need(stat.isFile()&&!stat.isSymbolicLink()&&!(stat.mode&0o022)&&realpathSync(path)===path,'FILE_SOURCE');
 const bytes=readFileSync(path);need(digest(bytes)===expected,'FILE_DIGEST');return bytes;
}
function checkedVersion(v,source){
 need(UUID.test(v?.id||'')&&v.source_commit===source&&v.source_repo==='perfectuser21/zenithjoy-workspace'
  &&typeof v.source_path==='string'&&v.payload_sha256===versionDigest(v),'VERSION');
}
function metadataFor(w,ref,av,entry,entryHash,skill){
 const c=av.payload.contract,base=`activity-definition:${av.id}`,version=c.version;
 need(typeof version==='string'&&version&&c.promise!==undefined&&c.preconditions!==undefined&&c.inputs!==undefined
  &&c.outputs!==undefined&&c.postconditions!==undefined&&c.failure!==undefined,'QUESTIONS');
 const declarations={A1:{promise:c.promise},A2:{inputs:c.inputs,preconditions:c.preconditions},A3:{outputs:c.outputs},
  A4:{postconditions:c.postconditions},A5:{budget:c.budget},A6:{failure:c.failure,idempotency:c.idempotency??null},
  B1:{implementation_bindings:av.payload.implementation_bindings??c.implementation_bindings??[],steps:av.payload.steps??[]}};
 return {activity_id:ref.activity_id,executor_kind:skill?'agent':'code',...(skill?{skill}:{}),identity:{identity_protocol:2,workflow_id:w.payload.workflow_id,
  reference_id:ref.reference_id,workflow_definition_version_id:w.id,activity_definition_version_id:av.id},
  implementation:{kind:skill?'agent':'code',entry,sha256:entryHash,source_activity_definition_version_id:av.id},
  questions:Object.fromEntries(Object.entries(declarations).map(([key,declared])=>[key,{ref:base+'#'+key,version,declared:clone(declared)}]))};
}
/** Inputs are original readbacks. All identities/versions/budgets derive from them. */
export function buildPublicDomainProfile({sourceRoot,frozen,observation,gate,resources,company,commander,profileId,env={}}={}){
 need(isAbsolute(sourceRoot||'')&&realpathSync(sourceRoot)===sourceRoot,'SOURCE_ROOT');
 need(/^[a-z][a-z0-9-]{0,63}$/.test(profileId||''),'PROFILE_ID');
 const f=clone(frozen),r=f?.release,d=f?.deployment,w=f?.workflow_version;
 need(r&&d&&w&&UUID.test(r.id)&&UUID.test(d.observation_id)&&/^[a-f0-9]{40}$/.test(d.source_commit||''),'FROZEN');
 const {snapshot_sha256,...body}=f;need(HASH.test(snapshot_sha256||'')&&snapshot_sha256===digest(body),'FROZEN_DIGEST');
 need(r.manifest_sha256===digest({environment:r.environment,target:r.target,payload:r.payload})&&d.release_id===r.id
  &&d.environment===r.environment&&d.target===r.target,'RELEASE');
 need(observation?.id===d.observation_id&&observation.release_id===r.id&&observation.payload?.environment===d.environment
  &&observation.payload?.target===d.target&&same(observation.payload?.components,r.payload.components),'OBSERVATION');
 need(gate?.deployed===true&&gate.actual_matches===true&&gate.current_observation_id===observation.id
  &&Array.isArray(gate.gaps)&&gate.gaps.length===0,'OBSERVATION_GATE');
 checkedVersion(w,d.source_commit);need(r.payload.workflows.some(v=>same(v,w)),'WORKFLOW_RELEASE');
 need(['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(w.payload.key),'WORKFLOW');
 const refs=w.payload.activities;need(Array.isArray(refs)&&refs.length&&refs.length===f.activities?.length,'ACTIVITIES');
 const target=({'us-mac-m4':'mmv','xian-mac-m4':'xian-m4'})[resources?.machine];
 need(target&&r.target===target&&resources.line&&resources.profile&&resources.serial&&resources.account,'RESOURCE');
 if(w.payload.key==='douyin_comment_scoring')need(resources.profile==='mmv-scoring'&&resources.serial==='none','SCORING_RESOURCE');
 else if(target==='mmv')need(resources.profile==='cloud-phone-test'&&resources.serial==='47.100.213.173:10001'&&resources.account==='77980009922','PHONE_RESOURCE');
 need(UUID.test(company?.company_id||'')&&UUID.test(company?.tenant_id||'')&&Number.isSafeInteger(company.version)&&company.version>0&&company.policy_id,'COMPANY');
 const files={};
 for(const row of d.files||[]){need(!Object.hasOwn(files,row.deployed_path),'DUPLICATE_FILE');file(sourceRoot,row.deployed_path,row.content_sha256);files[row.deployed_path]=row.content_sha256;}
 for(const [path,hash] of Object.entries(f.files||{}))if(path.startsWith('runtime/')){const name=path.slice(8);file(sourceRoot,name,hash);need(!files[name]||files[name]===hash,'FROZEN_FILE');files[name]=hash;}
 need(Object.keys(files).length&&files['leadgen-public-domain.mjs']&&files['public-domain-authority.mjs']&&files['public-domain-pg.mjs'],'DOMAIN_SOURCE');
 if(target==='xian-m4'&&w.payload.key!=='douyin_comment_scoring'){
  const scope=f[w.payload.key==='douyin_video_discovery'?'discovery_phone_scope':'collection_phone_scope'];
  const path='config/collection-phone-hosts.json';need(files[path],'PHONE_REGISTRY');
  const rows=JSON.parse(file(sourceRoot,path,files[path])).hosts?.filter(h=>h.target===target&&h.profile===resources.profile&&h.serial===resources.serial&&h.expected_account===resources.account&&h.workflow_keys?.includes(w.payload.key));
  need(rows?.length===1&&scope&&['target','profile','serial','expected_account'].every(k=>scope[k]===rows[0][k])&&same(scope.policy,rows[0].policy)&&scope.policy.schema_version===1&&scope.policy.transport==='usb'&&scope.policy.endpoint==='tcp:127.0.0.1:5037','PHONE_RESOURCE');
 }
 const manifest=JSON.parse(file(sourceRoot,'deployment-manifest.json',files['deployment-manifest.json']));need(same(manifest,d),'DEPLOYMENT_FILE');
 const pg=preflightPgDeployment({runtimeRoot:sourceRoot,sourceCommit:d.source_commit});
 need(same(pg,d.dependencies?.preflight_pg),'PG_DEPLOYMENT');
 for(const row of pg.files){file(sourceRoot,row.deployed_path,row.content_sha256);files[row.deployed_path]=row.content_sha256;}
 const executionMode=f.execution_mode??'code';need(['code','agent'].includes(executionMode),'EXECUTION_MODE');
 const entry='leadgen-public-domain.mjs',metadata={},preconditions={},validators={},activities=[],expected_path=[];
 const runtime_snapshot_sha256=digest(files);
 for(const ref of refs){
  need(UUID.test(ref.reference_id||'')&&UUID.test(ref.activity_id||'')&&UUID.test(ref.activity_version_id||'')&&typeof ref.slot_key==='string'&&!metadata[ref.slot_key],'ACTIVITY_IDENTITY');
  const original=f.activities.find(a=>a.reference.slot_key===ref.slot_key);need(original&&same(original.reference,ref),'FROZEN_ACTIVITY');
  const av=original.version;checkedVersion(av,d.source_commit);need(av.id===ref.activity_version_id&&av.payload.activity_id===ref.activity_id&&r.payload.activities.some(v=>same(v,av)),'ACTIVITY_RELEASE');
  const c=clone(av.payload.contract);need(Number.isSafeInteger(c.budget?.max_duration_s)&&c.budget.max_duration_s>0&&c.budget.max_duration_s<=14400
   &&Number.isSafeInteger(c.budget.heartbeat_s)&&c.budget.heartbeat_s>0&&c.budget.heartbeat_s<=c.budget.max_duration_s,'ACTIVITY_BUDGET');
  need(['setup','source','per_item','batch_end','finalize'].includes(c.runtime?.phase),'ACTIVITY_PHASE');
  // Native handlers already own their frozen whole-batch iteration. Match the
  // mature leadgen adapter: public Runner invokes each handler once; original
  // phase/foreach policy stays intact in the snapshot and declared metadata.
  const runtime={...c.runtime,protocol:'json-stdio-v1',phase:c.runtime.phase==='finalize'?'finalize':'source',entry};
  delete runtime.per_item;
  activities.push({...c,key:ref.slot_key,runtime});
  let skill;
  if(executionMode==='agent'){
   const bindings=(av.payload.implementation_bindings||[]).filter(b=>b.kind==='skill');
   const verified=(original.implementations||[]).filter(b=>b.kind==='skill'&&b.execution_verification==='verified_local');
   need(bindings.length===1&&verified.length===1,'SKILL_BINDING');const b=bindings[0],v=verified[0],prefix='services/phone-adb-controller/';
   need(b.status==='verified'&&b.repo===av.source_repo&&b.revision===d.source_commit&&b.path?.startsWith(prefix+'skills/')&&b.path===v.path&&b.version===v.version&&b.name===v.name,'SKILL_BINDING');
   const name=b.path.slice(prefix.length),expected=b.content_sha256||b.digest?.replace(/^sha256:/,'');
   need(v.execution_path==='runtime/'+name&&v.actual_content_sha256===expected&&files[name]===expected,'SKILL_SOURCE');
   const text=file(sourceRoot,name,expected).toString('utf8');
   need(text.includes('  primary_execution: agent-v1')&&text.includes('  version: '+b.version),'SKILL_PRIMARY');skill={entry:name,version:b.version};
  }
  const m=metadataFor(w,ref,av,entry,files[entry],skill);m.runtime_snapshot_sha256=runtime_snapshot_sha256;metadata[ref.slot_key]=m;
  preconditions[ref.slot_key]={entry,timeout_s:Math.min(30,c.budget.max_duration_s),acceptance:{ref:m.questions.A2.ref}};
  validators[ref.slot_key]={entry,timeout_s:Math.min(30,c.budget.max_duration_s),acceptance:{ref:m.questions.A4.ref}};
  expected_path.push({reference_id:ref.reference_id,activity_id:ref.activity_id,activity_definition_version_id:av.id});
  for(const step of av.payload.steps||[]){need(UUID.test(step.step_id||'')&&step.locator?.activity_id===ref.activity_id,'STEP_IDENTITY');expected_path.push({reference_id:ref.reference_id,activity_id:ref.activity_id,activity_definition_version_id:av.id,step_id:step.step_id});}
 }
 const cleanup=activities.filter(a=>a.runtime.phase==='finalize'),work=activities.filter(a=>a.runtime.phase!=='finalize');
 const sum=xs=>xs.reduce((n,a)=>n+a.budget.max_duration_s,0),policy=w.payload.contract.recovery;
 const cleanup_grace_s=Math.min(cleanup.length?sum(cleanup):Math.min(30,sum(work)-1),policy?.cleanup_timeout_sec??(cleanup.length?sum(cleanup):Math.min(30,sum(work)-1)));
 const max_duration_s=Math.min(sum(work),policy?.total_timeout_sec!==undefined?policy.total_timeout_sec-cleanup_grace_s:(cleanup.length?sum(work):sum(work)-cleanup_grace_s));
 need(Number.isSafeInteger(max_duration_s)&&max_duration_s>0&&Number.isSafeInteger(cleanup_grace_s)&&cleanup_grace_s>0&&max_duration_s+cleanup_grace_s<=14400,'WORKFLOW_BUDGET');
 need(commander?.kind==='openclaw'&&commander.skill?.version&&files[commander.skill?.entry]
  &&Number.isSafeInteger(commander.timeout_s)&&commander.timeout_s>0&&commander.timeout_s<=300,'COMMANDER');
 const skill=file(sourceRoot,commander.skill.entry,files[commander.skill.entry]).toString('utf8');
 need(new RegExp('(?:^|\\n) *(?:version|version:)').test(skill)&&skill.includes(commander.skill.version),'COMMANDER_VERSION');
 const step_spec=`plans/${w.payload.key}.steps.json`;need(files[step_spec],'STEP_SPEC');
 validators.workflow={entry,timeout_s:30,acceptance:{ref:`workflow-definition:${w.id}#acceptance`}};
 // cleanup is also an Activity key: retain its original AV A4 acceptance
 // for both per-Activity validation and the aggregate cleanup scope.
 const template={...f,public_pg:preflightPgLockIdentity({runtimeRoot:sourceRoot})};
 const domainEnv=clone(env);delete domainEnv.ZJ_ADB_HOST_CONFIG;
 if(w.payload.key!=='douyin_comment_scoring')template.preflight_profile=freezePreflightProfile({env:{...env,P:resources.profile,SERIAL:resources.serial}});
 if(w.payload.key!=='douyin_comment_scoring'){
  const scope=template.discovery_phone_scope||template.collection_phone_scope;
  if(scope){
   domainEnv.DOUYIN_ADB_PORT=scope.policy.endpoint.split(':').at(-1);domainEnv.ADB_SERVER_SOCKET=scope.policy.endpoint;
   if(target==='mmv')domainEnv.LEADGEN_MMV_DEVICE_RUNTIME='1';else delete domainEnv.LEADGEN_MMV_DEVICE_RUNTIME;
   const route=freezePublicPreflightRoute({root:sourceRoot,files,scope});
   if(route){need(same(route,scope.policy_binding),'SCOPE_ROUTE_BINDING');template.public_preflight_route=route;}
  }
 }
 const profile={cwd:sourceRoot,cleanup_required:cleanup.length>0,resources:cleanup.length?[clone(resources)]:[],files,metadata,preconditions,validators,commander:clone(commander),
  contract:{...clone(w.payload.contract),workflow:w.payload.key,activities},domain_adapter:{protocol:'workflow-domain/v1',entry,export_name:'createWorkflowDomain',budget:{max_duration_s,cleanup_grace_s},
   config:{workflow_key:w.payload.key,execution_mode:executionMode,resources:clone(resources),company:clone(company),env:domainEnv,step_spec,snapshot:template}}};
 const profile_sha256=digest(profile);
 const definition={release_id:r.id,observation_id:d.observation_id,workflow_id:w.payload.workflow_id,workflow_definition_version_id:w.id,snapshot_sha256:w.payload_sha256,runtime_snapshot_sha256,expected_path};
 const route={machine_id:resources.machine,profile_sha256};
 return {profile,profile_sha256,definition,route,worker_config:{schema_version:1,profiles:{[profileId]:profile}},brain_profiles:{profiles:{[profileId]:route}}};
}
