/** 正式main来源续版；生产只走现有API，源码核验/登记回归只写scratch。 */
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {AUTHORING_FILES,gitSource,isAuthoringRepositoryOrigin} from './authoring-source-version.mjs';
import {renewDefinitions} from './authoring-main-source-core.mjs';
import {scratchRegistration} from './authoring-source-scratch.mjs';
import {loadAuthoringScope} from './authoring-source-scope.mjs';
export {loadAuthoringScope};
const REPO='perfectuser21/zenithjoy-workspace',SHA=/^[a-f0-9]{40}$/;
const SPECS=[['commander-generic',AUTHORING_FILES.slice(0,2)],['cecelia-device-patrol-definitions',AUTHORING_FILES.slice(2)]];
const unwrap=x=>x?.task??x?.data??x;
export function createBrainApi(url,token,{fetchFn=globalThis.fetch}={}){
 const origin=new URL(url);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('AUTHORING_BRAIN_URL_INVALID');
 return async(method,path,body)=>{
  const response=await fetchFn(new URL(`/api/brain/${path}`,origin),{method,redirect:'error',headers:{'X-Internal-Token':token,'X-Session-ID':'ci:authoring-main-source','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
  const text=await response.text();if(text.length>8*1024*1024)throw Error('AUTHORING_API_RESPONSE_TOO_LARGE');
  const value=JSON.parse(text);if(!response.ok)throw Object.assign(Error(`AUTHORING_API_${response.status}:${value.error?.code??value.error??'unknown'}`),{status:response.status});return value;
 };
}
export async function createSourceTask(api,revision,key,parent,authoring=false,dependsOn=[]){
 const source=`authoring-main:${revision}:${key}`,title=`固定main来源续版 ${revision} ${key}`;
 const find=async()=>{
  // 近期GET用于丢回执恢复；缺项仍由服务端source_id幂等键判定，绝不换key另造任务。
  const rows=await api('GET','tasks?limit=1000');if(!Array.isArray(rows))throw Error('AUTHORING_TASK_LIST_INVALID');
  const matches=rows.filter(x=>x.title===title);if(matches.length>1)throw Error('AUTHORING_TASK_AMBIGUOUS');
  return matches[0]?unwrap(await api('GET',`tasks/${matches[0].id}`)):null;
 };
 let task=await find();
 if(!task){
  try{task=unwrap(await api('POST','tasks',{title,task_type:parent?'research':'project',status:'in_progress',mutation_intent:'read_only',source_id:source,trigger_source:'api',priority:'P2',...(parent?{parent_task_id:parent}:{}),payload:{headed_manual:'true',...(parent?{multi_task:true,depends_on:dependsOn}:{}),workflow_authoring:authoring,source_renewal:source,source_revision:revision,actor:'ci:authoring-main-source',acceptance:'仅固定Git冻结与scratch注册读回，不代表手机execution'}}));}
  catch(error){task=await find();if(!task)throw error;}
 }
 task=unwrap(await api('GET',`tasks/${task.id}`));
 if(task.payload?.source_renewal!==source||task.payload?.source_revision!==revision||task.payload?.workflow_authoring!==authoring)throw Error('AUTHORING_TASK_IDENTITY_CONFLICT');
 if(task.status==='completed')return task;
 if(!['queued','in_progress'].includes(task.status))throw Error('AUTHORING_TASK_NOT_WRITABLE');
 if(task.claimed_by&&task.claimed_by!=='ci:authoring-main-source')throw Error('AUTHORING_TASK_CLAIM_CONFLICT');
 if(!task.claimed_by){try{await api('POST',`tasks/${task.id}/claim`,{claimer:'ci:authoring-main-source',executor_kind:'headed-session',lease_seconds:14400,on_lease_expire:'fail'});}catch(error){const actual=unwrap(await api('GET',`tasks/${task.id}`));if(actual.claimed_by!=='ci:authoring-main-source')throw error;}}
 if(task.status==='queued')await api('PATCH',`tasks/${task.id}`,{status:'in_progress'});
 task=unwrap(await api('GET',`tasks/${task.id}`));
 if(task.status!=='in_progress'||task.claimed_by!=='ci:authoring-main-source')throw Error('AUTHORING_TASK_CLAIM_UNVERIFIED');return task;
}
export async function completeSourceTask(api,task,result){
 const matches=value=>Object.entries(result).every(([key,body])=>isDeepStrictEqual(value.result?.[key],body));
 if(task.status!=='completed'){
  try{await api('PATCH',`tasks/${task.id}`,{status:'completed',result});}catch(error){const actual=unwrap(await api('GET',`tasks/${task.id}`));if(actual.status!=='completed'||!matches(actual))throw error;}
 }
 const actual=unwrap(await api('GET',`tasks/${task.id}`));if(actual.status!=='completed'||!matches(actual))throw Error('AUTHORING_TASK_RESULT_READBACK_FAILED');return actual;
}
export async function submitSourceRegistration(api,task,item,validation,hash,checkMain=async()=>{}){
 let state=task.result?.workflow_authoring;
 if(!state){await checkMain();try{state=await api('POST',`workflow-authoring/runs/${task.id}/init`,{operation:'update',workflow_id:item.owner.id,expected_version:item.owner.version,goal:'固定main来源续版；真实冻结与scratch注册回归，不声明手机运行成功',actor:'ci:authoring-main-source',registration_protocol:'definition-freeze-v1'});}catch(error){try{state=await api('GET',`workflow-authoring/runs/${task.id}`);}catch{throw error;}await checkMain();}}
 if(state.outputs?.compose&&hash(state.outputs.compose.definition)!==hash(item.definition))throw Error('AUTHORING_RESUME_DEFINITION_CHANGED');
 const d=item.definition;
 const outputs={intake:{goal:'固定main来源续版',inputs:['固定Git定义'],outputs:['冻结定义读回'],acceptance:['source SHA、完整绑定、版本和有序活动一致'],capability_id:d.capability_id,workflow_id:item.owner.id},
  reuse:{search_terms:[d.key],candidates:[{kind:'workflow',id:item.owner.id,decision:'adapt',reason:'同一规范所有者的固定来源续版'}]},compose:{definition:d},
  build:{reuse_only:true,implementation_task_ids:[],evidence_refs:validation.result.workflow_validation.evidence_refs},verify:{validation_task_id:validation.id},register:{}};
 while(state.stage!=='completed'){
  const stage=state.stage;if(!Object.hasOwn(outputs,stage))throw Error('AUTHORING_UNKNOWN_STAGE');
  const body={stage,revision:state.revision,submission_id:`main-source:${d.source.revision}:${stage}`,output:outputs[stage]};
  await checkMain();
  try{state=(await api('POST',`workflow-authoring/runs/${task.id}/submit`,body)).state;}
  catch(error){const observed=await api('GET',`workflow-authoring/runs/${task.id}`);await checkMain();if(!observed.receipts?.some(r=>r.submission_id===body.submission_id))throw error;state=observed;}
 }
 const registered=state.outputs.register;
 if(!registered?.readback_verified||registered.workflow_id!==item.owner.id||registered.definition_sha256!==hash(d)||registered.version!==d.version)throw Error('AUTHORING_REGISTRATION_READBACK_FAILED');
 return completeSourceTask(api,task,{source_registration:{definition_sha256:hash(d),source:d.source,receipt:registered}});
}
export async function runMainSource({repoRoot=process.cwd(),brainRoot=process.env.AUTHORING_BRAIN_ROOT,output=resolve('evidence/authoring-source')}={}){
 const revision=process.env.GITHUB_SHA,tooling=process.env.AUTHORING_BRAIN_REVISION;
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!==REPO||process.env.AUTHORING_ALLOW_WRITE!=='1'||!SHA.test(revision||'')||!SHA.test(tooling||''))throw Error('AUTHORING_FORMAL_MAIN_REQUIRED');
 if(gitSource(repoRoot,['rev-parse','HEAD'])!==revision||gitSource(brainRoot,['rev-parse','HEAD'])!==tooling)throw Error('AUTHORING_CHECKOUT_SHA_MISMATCH');
 if(!isAuthoringRepositoryOrigin(gitSource(repoRoot,['remote','get-url','origin']),REPO))throw Error('AUTHORING_SOURCE_REPOSITORY_INVALID');
 if(!isAuthoringRepositoryOrigin(gitSource(brainRoot,['remote','get-url','origin']),'perfectuser21/cecelia'))throw Error('AUTHORING_TOOLING_REPOSITORY_INVALID');
 gitSource(brainRoot,['merge-base','--is-ancestor',tooling,'origin/main']);
 const load=p=>import(pathToFileURL(resolve(brainRoot,p)));
 const {registrationDigest:hash}=await load('packages/brain/src/workflow-authoring/registration.js');
 const {readFixedLocalGitBlob}=await load('scripts/ci/fixed-local-git.mjs');
 const {validateImplementationSnapshot}=await load('packages/brain/src/lib/implementation-ci-snapshot.js');
 const {digestMapManifest}=await load('packages/brain/src/lib/map-manifest-schema.js');
 const api=createBrainApi(process.env.BRAIN_URL,process.env.CECELIA_INTERNAL_TOKEN);
 const checkMain=async()=>{
  const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('GIT_')||k==='CECELIA_INTERNAL_TOKEN'||k==='DB_PASSWORD')delete env[k];
  const actual=execFileSync('gh',['api',`repos/${REPO}/commits/main`,'--jq','.sha'],{env,encoding:'utf8',timeout:30000,maxBuffer:1024}).trim();
  if(actual!==revision)throw Error('AUTHORING_SOURCE_MAIN_MOVED');
 };
 await checkMain();mkdirSync(output,{recursive:true});
 const root=await createSourceTask(api,revision,'root');
 const all=(await api('GET','workflows')).workflows;
 const skills=[];for(let offset=0;offset<5000;offset+=500){const rows=await api('GET',`skills?limit=500&offset=${offset}`);skills.push(...rows);if(rows.length<500)break;if(offset===4500)throw Error('AUTHORING_SKILL_LIST_TRUNCATED');}
 const scopes=[];
 for(const [scope,files] of SPECS){
  scopes.push(await loadAuthoringScope({api,scope,files,revision,repo:REPO,owners:all,skills,
   readDefinition:path=>({...JSON.parse(readFixedLocalGitBlob(repoRoot,{revision,path})),source:{repo:REPO,ref:path,revision}}),
   validateSnapshot:validateImplementationSnapshot,digestMapManifest}));
 }
 const validations=new Map();
 await renewDefinitions(scopes,{revision,hash,checkMain,
  task:async(key)=>{const task=await createSourceTask(api,revision,key,root.id);validations.set(key,task);return task;},
  verify:async(item)=>{
   const task=validations.get(`validation:${item.definition.key}`),old=task.result?.workflow_validation;
   if(task.status==='completed'){
    if(old?.verdict!=='PASS'||old.definition_sha256!==hash(item.definition)||old.validation_scope!=='fixed_git_freeze_scratch_registration')throw Error('AUTHORING_EXISTING_VALIDATION_INVALID');
    return {definition_sha256:old.definition_sha256,evidence_refs:old.evidence_refs};
   }
   return scratchRegistration(item,{brainRoot,repoRoot,output:join(output,`${item.definition.key}.json`),evidenceRef:`github:${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}#authoring-source/${item.definition.key}.json`});
  },
  complete:async(task,result)=>{const actual=await completeSourceTask(api,task,result);for(const [key,old] of validations)if(old.id===task.id)validations.set(key,actual);},
  register:async(item)=>{
   const validation=validations.get(`validation:${item.definition.key}`),task=await createSourceTask(api,revision,`register:${item.definition.key}`,root.id,true,[validation.id]);
   await checkMain();await submitSourceRegistration(api,task,item,validation,hash,checkMain);
  },
  activate:async(scope,body)=>{
   const manifest=structuredClone(scope.manifest.manifest);for(const section of ['value_streams','capabilities'])for(const n of manifest[section]){if(n.brain_binding?.source_repo!==REPO)throw Error('AUTHORING_MANIFEST_SOURCE_CONFLICT');n.brain_binding.source_revision=revision;}
   const wanted=digestMapManifest(manifest);let active=await api('GET',`map?scope=${scope.scope}`);
   if(active.manifest_digest===wanted)return;
   if(active.manifest_digest!==body.expected_active.digest||active.manifest_version_id!==body.expected_active.id)throw Error('AUTHORING_MAP_ACTIVE_CHANGED');
   await checkMain();const draft=await api('POST','map/manifests',manifest);await checkMain();
   try{await api('POST',`map/manifests/${draft.manifest_version.id}/activate`,body);}catch(error){active=await api('GET',`map?scope=${scope.scope}`);if(active.manifest_digest!==wanted)throw error;}
   active=await api('GET',`map?scope=${scope.scope}`);if(active.manifest_digest!==wanted)throw Error('AUTHORING_MAP_READBACK_FAILED');
  }});
 const result={revision,scopes:scopes.map(s=>s.scope),business_runtime_status:'not_evaluated',status:'registered'};
 await completeSourceTask(api,root,{source_renewal:result});writeFileSync(join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))runMainSource().catch(error=>{console.error(error.message);process.exitCode=1;});
