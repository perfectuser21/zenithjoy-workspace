// 本能力只表示固定collection闭包的同步手机请求已归还，绝不表示OS全后代已停。
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,fstatSync,realpathSync,symlinkSync,openSync,closeSync,constants,existsSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readFrozen} from './runtime-definition.mjs';
import {prepareCollectionAcceptanceProbe,validateCollectionAcceptanceProbe,verifiedCollectionPanelFailure,verifyCollectionAcceptanceConsumption} from './collection-acceptance-probe.mjs';
import {readBinding} from './runtime-binding.mjs';
import {startCollectionLeafProducer} from './collection-leaf-producer.mjs';
const proofRecords=new WeakMap(),generations=new WeakMap();
const sha=x=>createHash('sha256').update(x).digest('hex');
const required=['process-queued-video.sh','queued-video-lib.sh','wf-limits.sh','douyin-phone-adb','phone-lock-lib.sh','phone-lock-helper.py','adb-managed-client.py','adb-existing-route.py','leadgen-handlers.mjs','leadgen-video-action.mjs','leadgen-client.mjs','collection-phone-scope.mjs','collection-leaf-producer.mjs','collection-acceptance-probe.mjs','queued-comment-history.js','queued-recipient-evidence.js','own-accounts-lib.js','nickname-match-lib.js','line-routes.js','leadgen-db-lib.js','lead-fields-lib.js','config/own-accounts.json','locate-element.py'];
function failureDigest(result){const {recovery_phone_scope,execution_stopped,...body}=result||{};return sha(JSON.stringify(body));}
const semantic=new Set(['COLLECTION_COMMENT_PANEL_READBACK_FAILED','COLLECTION_VIDEO_IDENTITY_READBACK_FAILED','缺同视频采集完成标记','缺实际重扫计数，不能宣称采集通过','缺实际头像恢复计数，不能宣称采集通过']);
export const collectionSemanticReason=reason=>semantic.has(reason);
export function invalidateCollectionPhoneProof(state){generations.set(state,(generations.get(state)||0)+1);}
const identityKeys=['task_id','run_id','attempt','source_commit','profile','serial','activity','owner','target','deadline_ms','snapshot_sha256','binding_id'];
function fresh(record){
 try{return !record.consumed&&!record.state.executionUnknown&&!record.state.remainingVideoIds?.length&&record.generation===(generations.get(record.state)||0)&&Date.now()<record.identity.deadline_ms&&readFrozen(record.runDir).snapshot_sha256===record.identity.snapshot_sha256&&quietRecorders(record.evidence)&&!readdirSync(join(record.runDir,'native-operations')).some(x=>x.endsWith('.unknown'));}catch{return false;}
}
export function collectionPhoneProofValid(proof,context){
 const record=proof&&typeof proof==='object'?proofRecords.get(proof):null;
 return !!(record&&context&&identityKeys.every(key=>Object.hasOwn(context,key)&&record.identity[key]===context[key])&&fresh(record));
}
export function collectionEvidenceProof(evidence,context){
 const proof=evidence?.result?.recovery_phone_scope??evidence?.recovery_phone_scope,record=proof&&proofRecords.get(proof);
 if(!record||failureDigest(evidence?.result??evidence)!==record.failure_digest||!context||!['run_id','task_id','source_commit','activity'].every(key=>Object.hasOwn(context,key)&&record.identity[key]===context[key]))return null;
 return collectionPhoneProofValid(proof,{...record.identity,...context})?proof:null;
}
export function consumeCollectionPhoneProof(proof,context){
 if(!collectionPhoneProofValid(proof,context))return false;
 proofRecords.get(proof).consumed=true;return true;
}
function quietRecorders(directory){
 try{
  if(!isAbsolute(directory))return false;
  let cursor=resolve(directory);while(cursor!=='/'){try{const st=lstatSync(cursor);if(st.isSymbolicLink()||!st.isDirectory())return false;}catch(error){if(error.code!=='ENOENT')return false;}cursor=resolve(cursor,'..');}
  let files;try{files=readdirSync(directory);}catch(error){return error.code==='ENOENT';}
  for(const file of files.filter(x=>x.endsWith('.rec.pid'))){
   const path=join(directory,file),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   let text;try{if(!fstatSync(fd).isFile())return false;text=readFileSync(fd,'utf8').trim();}finally{closeSync(fd);}
   if(!/^[1-9][0-9]{0,9}$/.test(text)||Number(text)<=1)return false;
   try{process.kill(Number(text),0);return false;}catch(error){if(error.code!=='ESRCH')return false;}
  }
  return true;
 }catch{return false;}
}
export function readCollectionPhoneScopeInput(path){
 if(!isAbsolute(path||''))throw Error('COLLECTION_SCOPE_FILE_NOT_PRIVATE');
 let fd;try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=fstatSync(fd);
  if(!st.isFile()||(st.mode&0o777)!==0o600||st.uid!==process.getuid()||st.size>65536)throw Error('COLLECTION_SCOPE_FILE_NOT_PRIVATE');
  const value=JSON.parse(readFileSync(fd,'utf8'));
  const keys=['version','task_id','run_id','attempt','source_commit','profile','serial','target','evidence_root','policy','executables','expected_account','acceptance_probe'];
  if(!value||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k))||value.version!==1||!Object.hasOwn(value,'task_id')||value.task_id!==null&&typeof value.task_id!=='string'||!/^a[1-9][0-9]*$/.test(value.attempt||'')||!/^[a-f0-9]{40}$/.test(value.source_commit||'')||!['run_id','profile','serial','target','evidence_root'].every(k=>typeof value[k]==='string'&&value[k]))throw Error('COLLECTION_SCOPE_INPUT_INVALID');
  if(value.acceptance_probe)validateCollectionAcceptanceProbe(value.acceptance_probe);
  return value;
 }catch(error){if(error.code==='ELOOP')throw Error('COLLECTION_SCOPE_FILE_NOT_PRIVATE');throw error;}finally{if(fd!==undefined)closeSync(fd);}
}
// 模板是发布清单内已批准的只读输入；续跑永远取原快照，不追当前模板。
export function defaultCollectionPhoneScope({root,env}){
 if(env.WF_BRAIN_WORKFLOW!=='douyin_video_processing')return undefined;
 if(existsSync(join(env.WFR_RUN_DIR,'run-definition.json')))return readFrozen(env.WFR_RUN_DIR).collection_phone_scope;
 const manifest=JSON.parse(readFileSync(env.WF_DEPLOYMENT_MANIFEST||join(root,'deployment-manifest.json'),'utf8'));
 const relative='config/collection-phone-hosts.json',entry=manifest.files?.find(x=>x.deployed_path===relative);
 if(!entry)return undefined;
 const bytes=readFileSync(join(root,relative));if(sha(bytes)!==entry.content_sha256||entry.path!=='services/phone-adb-controller/'+relative)throw Error('COLLECTION_DEFAULT_TEMPLATE_SOURCE_INVALID');
 const template=JSON.parse(bytes);if(template.version!==1||!Array.isArray(template.hosts))throw Error('COLLECTION_DEFAULT_TEMPLATE_INVALID');
 const matches=template.hosts.filter(x=>x.target===manifest.target&&x.profile===env.P&&x.serial===env.SERIAL);
 if(!matches.length)return undefined;if(matches[0].acceptance_probe)throw Error('COLLECTION_ACCEPTANCE_PROBE_EXPLICIT_INPUT_REQUIRED');
 if(matches.length!==1||!matches[0].expected_account)throw Error('COLLECTION_DEFAULT_TEMPLATE_INVALID');
 return {...structuredClone(matches[0]),version:1,task_id:null,attempt:'a1',run_id:env.WFR_RUN_ID+'__a1',source_commit:manifest.source_commit};
}
function pinnedTool(tool){
 if(!tool||!isAbsolute(tool.path||'')||!/^[a-f0-9]{64}$/.test(tool.sha256||''))throw Error('COLLECTION_INTERPRETER_PIN_REQUIRED');
 const path=realpathSync(tool.path),stat=lstatSync(path);
 if(!stat.isFile()||(stat.mode&0o022)||sha(readFileSync(path))!==tool.sha256)throw Error('COLLECTION_INTERPRETER_PIN_MISMATCH');
 return path;
}
export async function startCollectionPhoneScope({root,env,state,sourceCommit,taskId,qualifiedVideoIds}){
 let frozen;try{frozen=readFrozen(env.WFR_RUN_DIR);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!frozen.collection_phone_scope)return null;
 const specification=structuredClone(frozen.collection_phone_scope),binding=readBinding(env.WFR_RUN_DIR,env.WFR_ATTEMPT,frozen);
 const identity={task_id:taskId??null,run_id:`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`,attempt:env.WFR_ATTEMPT,source_commit:sourceCommit,profile:env.P,serial:env.SERIAL,activity:'collection',owner:env.WFR_TAG,target:frozen.deployment.target,deadline_ms:state.budgetDeadline,snapshot_sha256:frozen.snapshot_sha256,binding_id:binding.id};
 if(specification.version!==1||binding.run_id!==identity.run_id||binding.task_id!==identity.task_id||frozen.deployment.source_commit!==sourceCommit||state.currentActivity!=='collection'||!Number.isSafeInteger(identity.deadline_ms)||Date.now()>=identity.deadline_ms||state.executionUnknown)throw Error('COLLECTION_PHONE_SCOPE_IDENTITY_INVALID');
 for(const key of ['task_id','run_id','attempt','source_commit','profile','serial','target'])if(specification[key]!==identity[key])throw Error('COLLECTION_PHONE_SCOPE_IDENTITY_INVALID');
 if(specification.expected_account&&String(state.account)!==specification.expected_account)throw Error('COLLECTION_PHONE_ACCOUNT_INVALID');
 if(realpathSync(root)!==realpathSync(join(env.WFR_RUN_DIR,'runtime'))||env.DOUYIN_PHONE_ADB!==join(root,'douyin-phone-adb'))throw Error('COLLECTION_PHONE_SOURCE_INVALID');
 for(const file of required)if(!frozen.files['runtime/'+file]||sha(readFileSync(join(root,file)))!==frozen.files['runtime/'+file])throw Error('COLLECTION_PHONE_SOURCE_INVALID');
 for(const [key,value] of Object.entries(env))if(value&&(/^(DYLD_|LD_)/.test(key)||['PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT','NODE_OPTIONS','NODE_PATH'].includes(key)))throw Error('COLLECTION_AMBIENT_INJECTION_REFUSED');
 for(const [key,path] of [['DOUYIN_CURL_BIN','/usr/bin/curl'],['DOUYIN_SIPS_BIN','/usr/bin/sips'],['DOUYIN_LOCATE_SCRIPT',join(root,'locate-element.py')]])if(env[key]&&env[key]!==path)throw Error('COLLECTION_TOOL_OVERRIDE_REFUSED');
 if(env.DOUYIN_BYPASS_REPORT_BIN||env.OWN_ACCOUNTS_CONF)throw Error('COLLECTION_TOOL_OVERRIDE_REFUSED');
 const python=pinnedTool(specification.executables?.python),node=pinnedTool(specification.executables?.node),zsh=pinnedTool(specification.executables?.zsh);
 if(node!==realpathSync(process.execPath))throw Error('COLLECTION_PARENT_NODE_PIN_MISMATCH');
 const evidence=resolve(env.DOUYIN_PHONE_TMP_ROOT||'/private/tmp/openclaw-phone','evidence',env.P);
 if(specification.evidence_root!==evidence||!quietRecorders(evidence))throw Error('COLLECTION_MANAGED_RECORDING_UNVERIFIED');
 const directory=join(env.WFR_RUN_DIR,'collection-phone-scopes',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
 const policy=specification.policy;
 if(policy?.host_id!==identity.target||!['xian-m4','mmv'].includes(policy.host_id))throw Error('COLLECTION_PHONE_HOST_INVALID');
 const policyFile=join(directory,'policy.json');writeFileSync(policyFile,JSON.stringify(policy),{flag:'wx',mode:0o600});
 const bin=join(directory,'bin');mkdirSync(bin,{mode:0o700});for(const [name,path] of [['python3',python],['node',node],['zsh',zsh]])symlinkSync(path,join(bin,name));
 const producer=await startCollectionLeafProducer({directory,policy,serial:identity.serial,deadlineMs:identity.deadline_ms,env});
 let acceptanceEnv;try{acceptanceEnv=prepareCollectionAcceptanceProbe({frozen,binding,env,qualifiedVideoIds,directory,producer});}catch(error){await producer.close();throw error;}
 const scopedEnv={...producer.env,WFR_COLLECTION_ACCEPTANCE_INPUT:'',...acceptanceEnv,WFR_COLLECTION_POLICY_FILE:policyFile,DOUYIN_PHONE_ADB:join(root,'douyin-phone-adb'),DOUYIN_ADB_BIN:join(root,'adb-managed-client.py'),DOUYIN_PYTHON_BIN:python,PATH:bin+':/usr/bin:/bin:/usr/sbin:/sbin',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:'',PYTHONHOME:'',NODE_OPTIONS:'',NODE_PATH:'',ZDOTDIR:directory,ENV:'',BASH_ENV:''};
 return {env:scopedEnv,zsh,panelFailure:(result,videoId,startedAt)=>verifiedCollectionPanelFailure(result,{evidenceRoot:evidence,videoId,owner:identity.owner,attempt:identity.attempt,startedAt})&&verifyCollectionAcceptanceConsumption({frozen,binding,env}),
  finish:async result=>{
   const status=await producer.seal();await producer.close();
   const current=readFrozen(env.WFR_RUN_DIR);
   if(!status.complete||state.executionUnknown||current.snapshot_sha256!==frozen.snapshot_sha256||!quietRecorders(evidence)||Date.now()>=identity.deadline_ms)return result;
   if(result.status!=='partial'||!result.failures?.length||!result.failures.every(x=>collectionSemanticReason(x.reason))||state.remainingVideoIds?.length)return result;
   const proof=Object.freeze({protocol:'collection-phone-scope-v1',scope_id:randomUUID()});
   proofRecords.set(proof,{identity,state,failure_digest:failureDigest(result),runDir:env.WFR_RUN_DIR,evidence,generation:generations.get(state)||0,consumed:false});
   return {...result,recovery_phone_scope:proof};
  },close:producer.close};
}
