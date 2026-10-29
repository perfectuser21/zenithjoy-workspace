// 101的手机请求归还能力仅用于原cleanup；不表示OS全后代停止，不授予采集恢复。
import {readFileSync,writeFileSync,lstatSync,realpathSync,readdirSync,mkdirSync,symlinkSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readFrozen} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {defaultCollectionPhoneScope} from './collection-phone-scope.mjs';
import {startCollectionLeafProducer} from './collection-leaf-producer.mjs';
const records=new WeakMap(),epochs=new WeakMap();
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=reason=>{throw Error('DISCOVERY_PHONE_'+reason);};
// 仅101 collect实际执行与准入共用；tap30s是新操作cap，不是截图20s的完整上界。
const discoveryCommandSeconds=Object.freeze({'current-video-link':300,'search-video-tab':180,'lock-refresh':10,'search-kw-matches':10,'tap-evidence':30});
export const discoveryCommandBudgetMs=command=>(Object.hasOwn(discoveryCommandSeconds,command)?discoveryCommandSeconds[command]:120)*1000;
export const discoveryTapBudgetMs=discoveryCommandBudgetMs('tap-evidence')+3000+discoveryCommandBudgetMs('lock-refresh')+discoveryCommandBudgetMs('current-video-link');
// 无重定位正常单遍的名义cap和；额外核验/PG/启动时间仍消费原绝对截止。
export const discoveryCaptureBudgetMs=4*discoveryCommandBudgetMs('lock-refresh')+discoveryCommandBudgetMs('search-video-cards')+discoveryCommandBudgetMs('search-kw-matches')+discoveryTapBudgetMs-discoveryCommandBudgetMs('lock-refresh');
const digest=result=>{const {cleanup_phone_scope,execution_stopped,...body}=result||{};return hash(JSON.stringify(body));};
const required=['leadgen-discovery-action.mjs','leadgen-phone-action.mjs','leadgen-handlers.mjs','leadgen-workflow.mjs','leadgen-discovery.mjs','activity-commander.mjs','discovery-phone-scope.mjs','collection-leaf-producer.mjs','adb-managed-client.py','adb-existing-route.py','douyin-phone-adb','phone-lock-lib.sh','phone-lock-helper.py','search-video-tab.py','discovery-cleanup-readback.mjs','discovery-metrics.js'];
export function defaultDiscoveryPhoneScope({root,env}){
 if(env.WF_BRAIN_WORKFLOW!=='douyin_video_discovery')return undefined;
 try{return readFrozen(env.WFR_RUN_DIR).discovery_phone_scope;}catch(error){if(error.code!=='ENOENT')throw error;}
 return defaultCollectionPhoneScope({root,env:{...env,WF_BRAIN_WORKFLOW:'douyin_video_processing'},workflowKey:'douyin_video_discovery'});
}
function pinned(tool){
 if(!isAbsolute(tool?.path||'')||!/^[a-f0-9]{64}$/.test(tool?.sha256||''))fail('TOOL_PIN_REQUIRED');
 const path=realpathSync(tool.path),st=lstatSync(path);
 if(!st.isFile()||(st.mode&0o022)||hash(readFileSync(path))!==tool.sha256)fail('TOOL_PIN_MISMATCH');
 return path;
}
function sourceStable(root,frozen){
 for(const name of required)if(!frozen.files['runtime/'+name])return false;
 // 固定本run的完整执行闭包，避免101新增helper却漏在102 required表之外。
 return Object.entries(frozen.files).filter(([name])=>name.startsWith('runtime/')).every(([name,sha])=>{
  const path=join(root,name.slice(8)),st=lstatSync(path);
  return st.isFile()&&!st.isSymbolicLink()&&!(st.mode&0o022)&&hash(readFileSync(path))===sha;
 });
}
function quiet(directory){
 try{for(let p=directory;p!=='/';p=resolve(p,'..')){try{const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())return false;}catch(e){if(e.code!=='ENOENT')return false;}}
  return readdirSync(directory).filter(x=>x.endsWith('.rec.pid')).every(x=>{const p=join(directory,x),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink())return false;const value=readFileSync(p,'utf8').trim();if(!/^[1-9][0-9]{0,9}$/.test(value)||Number(value)<=1)return false;try{process.kill(Number(value),0);return false;}catch(e){return e.code==='ESRCH';}});
 }catch(e){return e.code==='ENOENT';}
}
function layout(root,env,spec){
 const requested=resolve(env.DOUYIN_PHONE_TMP_ROOT||'/private/tmp/openclaw-phone'),evidence=join(requested,'evidence',env.P);
 if(evidence!==spec.evidence_root)fail('EVIDENCE_ROOT_MISMATCH');
 if(spec.evidence_alias){
  const alias=spec.evidence_alias,hosts=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'),'utf8')).hosts;
  if(alias.path!==requested||!isAbsolute(alias.target)||!hosts.some(h=>['target','profile','serial','expected_account','evidence_root'].every(k=>h[k]===spec[k])&&JSON.stringify(h.evidence_alias)===JSON.stringify(alias)))fail('EVIDENCE_ALIAS_UNAUTHORIZED');
  const st=lstatSync(requested);if(!st.isSymbolicLink()||st.uid!==process.getuid()||realpathSync(requested)!==alias.target)fail('EVIDENCE_ALIAS_CHANGED');
  if(!spec.evidence_identity?.entries?.length||!spec.evidence_identity.entries.every(e=>{const s=lstatSync(e.path);return ['dev','ino','uid','mode'].every(k=>s[k]===e[k]);}))fail('EVIDENCE_ALIAS_CHANGED');
  return {phoneRoot:realpathSync(requested),evidence:join(alias.target,'evidence',env.P)};
 }
 return {phoneRoot:requested,evidence};
}
function ownerIdentity(path,owner){
 const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o022)||![owner,owner+'\n'].includes(readFileSync(path,'utf8')))fail('LOCK_OWNER_MISMATCH');
 return [st.dev,st.ino,st.uid];
}
function unchanged(r){
 try{return !r.state.executionUnknown&&epochs.get(r.state)===r.epoch&&Date.now()<r.identity.global_deadline_ms
  &&readFrozen(r.env.WFR_RUN_DIR).snapshot_sha256===r.identity.snapshot_sha256&&r.state.account===r.identity.account
  &&['WFR_RUN_ID','WFR_ATTEMPT','WFR_TAG','P','SERIAL','WF_RUN_START_TS','WF_RUN_MAX_SECONDS','DOUYIN_PHONE_ADB','PYTHONPATH','PYTHONHOME','NODE_OPTIONS','NODE_PATH'].every(k=>r.env[k]===r.originalEnv[k])
  &&r.state.discoveryWorkDeadline===r.identity.work_deadline_ms&&r.state.source_commit===r.identity.source_commit&&r.state.run_id===r.identity.run_id&&r.state.task_id===r.identity.task_id
  &&readBinding(r.env.WFR_RUN_DIR,r.env.WFR_ATTEMPT,r.frozen).id===r.identity.binding_id
  &&hash(readFileSync(realpathSync(r.spec.policy.adb_bin)))===r.identity.client_sha256
  &&r.env.ADB_SERVER_SOCKET===r.originalEnv.ADB_SERVER_SOCKET&&r.env.DOUYIN_ADB_PORT===r.originalEnv.DOUYIN_ADB_PORT
  &&JSON.stringify(ownerIdentity(r.ownerFile,r.identity.owner))===JSON.stringify(r.ownerIdentity)
  &&JSON.stringify(layout(r.root,r.env,r.spec))===JSON.stringify(r.layout)&&quiet(r.layout.evidence)
  &&!readdirSync(join(r.env.WFR_RUN_DIR,'native-operations')).some(x=>x.endsWith('.unknown'))&&sourceStable(r.root,r.frozen);
 }catch{return false;}
}
export function discoveryCleanupEvidence(evidence,context){
 const result=evidence?.result??evidence,proof=result?.cleanup_phone_scope,r=proof&&records.get(proof);
 if(!r||r.consumed||digest(result)!==r.resultDigest||!context||!['run_id','task_id','source_commit','activity'].every(k=>Object.hasOwn(context,k)&&context[k]===r.identity[k])||Object.entries(context).some(([k,v])=>Object.hasOwn(r.identity,k)&&v!==r.identity[k])||!unchanged(r))return null;
 return proof;
}
// 有限搜索停止只说明本轮已安全收束且清单可核验；覆盖范围仍是 partial。
// parent 的不可克隆 cleanup 能力先证明所有原生叶子封闭，再核本 run 的落盘进度。
export function discoveryFiniteStopEvidence(evidence,context){
 const result=evidence?.result??evidence,proof=discoveryCleanupEvidence(result,context);
 if(!proof||result.status!=='partial'||!['screen_limit','candidate_limit_reached','manifest_limit'].includes(result.stop_reason)
  ||result.pending_capture!==null||result.manifest_verified!==1||result.video_manifest_readback_failures!==0
  ||!Array.isArray(result.failures)||result.failures.length||!Array.isArray(result.videos)||!Array.isArray(result.captures)
  ||!Number.isSafeInteger(result.counts?.persisted)||result.counts.persisted!==result.videos.length
  ||!Number.isSafeInteger(result.counts?.screens)||result.counts.screens<1||result.all_results_scanned!==false)return null;
 try{
  const issuer=records.get(proof),path=join(issuer.env.WFR_RUN_DIR,'discovery-progress.json'),st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>10*1024*1024)return null;
  const progress=JSON.parse(readFileSync(path,'utf8'));
  const maxScreens=Number(issuer.originalEnv.LEADGEN_MAX_SCREENS||100);
  const bounded=result.stop_reason==='screen_limit'?Number.isSafeInteger(maxScreens)&&maxScreens>=1&&result.counts.screens>=maxScreens
   :result.stop_reason==='candidate_limit_reached'?Number.isSafeInteger(progress.request?.max_candidates)&&result.counts.attempted>=progress.request.max_candidates
   :result.counts.persisted===1000;
  if(!bounded||progress.run!==issuer.identity.owner||progress.profile!==issuer.identity.profile
   ||['counts','videos','captures','failures','known_gaps','pending_capture','stop_reason','all_results_scanned'].some(k=>JSON.stringify(progress[k])!==JSON.stringify(result[k])))return null;
  return proof;
 }catch{return null;}
}
export async function startDiscoveryPhoneScope({root,env,state,sourceCommit,taskId,lockHeld,purpose='collect',evidence}){
 const frozen=readFrozen(env.WFR_RUN_DIR),spec=frozen.discovery_phone_scope;
 if(!spec)fail('SCOPE_REQUIRED');
 if(!['collect','cleanup'].includes(purpose))fail('PURPOSE_INVALID');
 const binding=readBinding(env.WFR_RUN_DIR,env.WFR_ATTEMPT,frozen),globalDeadline=(Number(env.WF_RUN_START_TS)+Number(env.WF_RUN_MAX_SECONDS))*1000;
 const identity={purpose:'cleanup_only',task_id:taskId??null,run_id:`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`,attempt:env.WFR_ATTEMPT,source_commit:sourceCommit,profile:env.P,serial:env.SERIAL,activity:'collect_videos',owner:env.WFR_TAG,target:frozen.deployment.target,account:state.account,snapshot_sha256:frozen.snapshot_sha256,binding_id:binding.id,work_deadline_ms:state.discoveryWorkDeadline??state.budgetDeadline,global_deadline_ms:globalDeadline,route:spec.policy?.endpoint,client_sha256:spec.policy?.adb_sha256};
 if(!lockHeld||state.executionUnknown||state.currentActivity!==(purpose==='collect'?'collect_videos':'cleanup')||!Number.isSafeInteger(globalDeadline)||Date.now()>=globalDeadline||!Number.isSafeInteger(identity.work_deadline_ms)||identity.work_deadline_ms>=globalDeadline)fail('IDENTITY_INVALID');
 for(const k of ['task_id','run_id','attempt','source_commit','profile','serial','target'])if(spec[k]!==identity[k])fail('IDENTITY_INVALID');
 if(binding.run_id!==identity.run_id||binding.task_id!==identity.task_id||frozen.deployment.source_commit!==sourceCommit||!spec.expected_account||spec.expected_account!==state.account)fail('IDENTITY_INVALID');
 if(realpathSync(root)!==realpathSync(join(env.WFR_RUN_DIR,'runtime'))||env.DOUYIN_PHONE_ADB!==join(root,'douyin-phone-adb')||!sourceStable(root,frozen))fail('SOURCE_INVALID');
 if(Object.entries(env).some(([k,v])=>v&&(/^(DYLD_|LD_)/.test(k)||['PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT','NODE_OPTIONS','NODE_PATH','DOUYIN_BYPASS_REPORT_BIN','OWN_ACCOUNTS_CONF'].includes(k))))fail('AMBIENT_OVERRIDE_REFUSED');
 for(const [k,v] of [['DOUYIN_CURL_BIN','/usr/bin/curl'],['DOUYIN_SIPS_BIN','/usr/bin/sips'],['DOUYIN_LOCATE_SCRIPT',join(root,'locate-element.py')]])if(env[k]&&env[k]!==v)fail('TOOL_OVERRIDE_REFUSED');
 const paths=layout(root,env,spec),ownerFile=join(paths.phoneRoot,'locks',env.SERIAL+'.lock','owner'),owner=ownerIdentity(ownerFile,identity.owner);
 if(!quiet(paths.evidence)||readdirSync(join(env.WFR_RUN_DIR,'native-operations')).some(x=>x.endsWith('.unknown')))fail('EXISTING_UNKNOWN');
 if(purpose==='collect'){
  if(epochs.has(state)||Date.now()>=identity.work_deadline_ms)fail('COLLECT_CLOSED');
  epochs.set(state,randomUUID());state.discoveryWorkDeadline=identity.work_deadline_ms;
 }else{
  const proof=discoveryCleanupEvidence(evidence,{run_id:identity.run_id,task_id:identity.task_id,source_commit:sourceCommit,activity:'collect_videos'});
  if(!proof)fail('CLEANUP_AUTHORITY_INVALID');records.get(proof).consumed=true;
 }
 const python=pinned(spec.executables?.python),node=pinned(spec.executables?.node),zsh=pinned(spec.executables?.zsh);
 if(node!==realpathSync(process.execPath)||!['xian-m4','mmv'].includes(spec.policy?.host_id)||spec.policy.host_id!==identity.target)fail('HOST_PIN_INVALID');
 const scopeRoot=join(env.WFR_RUN_DIR,'discovery-phone-scopes');mkdirSync(scopeRoot,{recursive:true,mode:0o700});
 const directory=join(scopeRoot,purpose==='collect'?'collect':randomUUID());mkdirSync(directory,{mode:0o700});
 const policyFile=join(directory,'policy.json');writeFileSync(policyFile,JSON.stringify(spec.policy),{flag:'wx',mode:0o600});const bin=join(directory,'bin');mkdirSync(bin,{mode:0o700});for(const [n,p] of [['python3',python],['node',node],['zsh',zsh]])symlinkSync(p,join(bin,n));
 const deadline=purpose==='collect'?identity.work_deadline_ms:globalDeadline,producer=await startCollectionLeafProducer({directory,policy:spec.policy,serial:env.SERIAL,deadlineMs:deadline,env});
 let sealing;const seal=()=>sealing??=producer.seal();const timer=setTimeout(()=>{seal().catch(()=>{});},Math.max(1,deadline-Date.now()));
 const r={identity:{...identity,epoch:epochs.get(state)},epoch:epochs.get(state),state,env,originalEnv:{...env},root,spec,frozen,layout:paths,ownerFile,ownerIdentity:owner,consumed:false};
 const scopedEnv={...producer.env,WFR_COLLECTION_POLICY_FILE:policyFile,DOUYIN_ADB_BIN:join(root,'adb-managed-client.py'),DOUYIN_PYTHON_BIN:python,DOUYIN_PHONE_TMP_ROOT:paths.phoneRoot,PATH:bin+':/usr/bin:/bin:/usr/sbin:/sbin',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:'',PYTHONHOME:'',NODE_OPTIONS:'',NODE_PATH:'',ZDOTDIR:directory,ENV:'',BASH_ENV:''};
 return {env:scopedEnv,zsh,assert:()=>{if(!unchanged(r))fail('SCOPE_CHANGED');},seal:async()=>{const s=await seal();if(!(s.complete||s.empty_complete)||!unchanged(r))fail('DRAIN_UNVERIFIED');return s;},close:async()=>{clearTimeout(timer);await producer.close();},finish:async result=>{
  try{const s=await seal();if(!(s.complete||s.empty_complete)||!unchanged(r))return result;
   const proof=Object.freeze({protocol:'discovery-cleanup-only-v1',purpose:'cleanup_only',scope_id:randomUUID()});r.resultDigest=digest(result);records.set(proof,r);return {...result,cleanup_phone_scope:proof};
  }finally{clearTimeout(timer);await producer.close();}
 }};
}
