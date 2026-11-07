// Public Code-owned phone execution. A Worker can request only original finite
// macros; it never supplies provenance, a resource lease, SQL or a stop verdict.
import {createRequire} from 'node:module';
import {runProbes} from './verify-step.mjs';
import {readFileSync,writeFileSync,fsyncSync,lstatSync,realpathSync,mkdirSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,readFrozen,assertAgentInput} from './runtime-definition.mjs';
import {rpcSource} from './leadgen-client.mjs';
import {verifyRpcSource} from './leadgen-rpc.mjs';
import {assertFrozenNativeTaskLease,assertNativeTaskAssociation} from './native-task-lease.mjs';
import {isPreflightRuntime,issuePreflightPhoneHandoff,readPreflightPhoneHandoff} from './preflight-phone-scope.mjs';
import {createPreflightPoolFactory,assertPreflightProfile} from './preflight-control-scope.mjs';
import {createNativeActivityAuthority,readNativeAuthorityProjection,nativeAuthorityProjectionMatches} from './native-activity-authority.mjs';
import {createNativePhoneAdbRead,createNativePhoneEvidenceRead} from './native-phone-adb-read.mjs';
import {createNativePhoneSourceIssuer,readNativePhoneCommandSource} from './native-phone-command-source.mjs';
import {createNativePhoneCommandObserver} from './adb-shell-v2.mjs';
import {startNativePhoneLocalProducer,nativePhoneLocalFailureReturned} from './native-phone-local-producer.mjs';
import {startNativePhoneVision} from './native-phone-vision.mjs';
import {createNativePhoneClipState} from './native-phone-clip-state.mjs';
import {createNativePhoneUi} from './native-phone-ui.mjs';
import {createNativePhoneSearchMacros} from './native-phone-search-macros.mjs';
import {createNativePhoneLinkMacros} from './native-phone-link-macros.mjs';
import discoveryMetrics from './discovery-metrics.js';
import {createNativePhoneQueue,readNativePhoneQueueReceipts,readNativePhoneQueueActivity} from './native-phone-queue.mjs';
import {rawModelScopeStopped} from './activity-skill-parent-loop.mjs';
import {skillLaunchDidNotStart} from './activity-skill-executor.mjs';
const require=createRequire(import.meta.url),runtimes=new WeakSet(),cleanupRoutes=new WeakMap(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,unknown=false)=>Object.assign(Error('NATIVE_PHONE_'+code),{code:'NATIVE_PHONE_'+code,executionStopped:!unknown,resourceUnknown:unknown});
export const isNativePhoneRuntime=value=>runtimes.has(value);
export function authorizeNativePhoneCleanupTransition(runtime,{request}={}){const read=cleanupRoutes.get(runtime);if(!read)throw fail('CLEANUP_ROUTE');return read(request);}
export function firstNativePhoneFocus(raw){return String(raw).replaceAll('\r','').split('\n').find(line=>/^\s*(mCurrentFocus|mFocusedApp)\s*=/.test(line)&&!/=null(?:\s|$)/.test(line))?.trim()||'unknown';}
export const NATIVE_PHONE_FILES=Object.freeze(['native-phone-runtime.mjs','native-phone-vision.mjs','native-phone-vision-step.py','locate-element.py','native-phone-clip-state.mjs','native-phone-adb-read.mjs','native-phone-command-source.mjs','adb-shell-v2.mjs','adb-shell-v2-protocol.mjs','native-phone-local-producer.mjs','native-phone-ui.mjs','native-phone-ui-step.py','native-phone-search-macros.mjs','native-phone-search-step.py','native-phone-link-macros.mjs','native-phone-link-step.py','native-phone-queue.mjs','native-phone-preflight-adapter.mjs','native-phone-link-resolver.mjs','native-activity-authority.mjs','native-task-lease.mjs']);
const slots=['preflight','collect_videos','cleanup'];
const requiredCommands=['pause','dump','tap','search','foreground','window','screenshot','sdk','keyevent','swipe','long-press','current-ime','ime-enable','ime-set','clear-nonce','broadcast-nonce','input-nonce','input-select-all','scratch-search','open-detail','remove-ui','stat-ui','stat-ui-mtime','ui-exists','ui-symlink','device-date','model','telecom','wake','unlock','open-app','close-app','home-resolve','dump-file','screenshot-file'];
export function nativePhoneSource(frozen){
 const source=rpcSource(frozen);
 for(const [key,sha256] of Object.entries(frozen.files||{}))if(key.startsWith('runtime/')){
  const path=key.slice(8),rows=source.files.filter(f=>f.path===path);
  if(rows.length>1||rows.length&&rows[0].sha256!==sha256)throw fail('SOURCE');
  if(!rows.length)source.files.push({path,sha256});
 }
 for(const name of [...NATIVE_PHONE_FILES,'config/native-phone-command-sources.json'])if(source.files.filter(f=>f.path===name).length!==1)throw fail('SOURCE');
 return source;
}
export function createNativePhoneRuntime(options={}){
 if(!options||Object.getPrototypeOf(options)!==Object.prototype||Object.keys(options).some(key=>!['root','env','frozen','binding','taskId','preflightRuntime','createAuthorityControl','poolFactory','requestImpl','visionCredential'].includes(key)))throw fail('SCOPE');
 const {root,env,frozen,binding,taskId,preflightRuntime,createAuthorityControl,poolFactory,requestImpl,visionCredential}=options;
 let prepared=false,unsafe=false,judgeUnknown=false,source,input,spec,profile,lease,policy,makePool,active,index=0,unstartedScope;
 const entries=[],seen=new Set(),cache=new Map();
 const nativeMetrics=Object.freeze({parseDescriptions(xml){const v=cache.get(hash(xml));if(!v)throw fail('METRICS_UNPRIMED');return structuredClone(v);}});
 function verify(){
  if(!prepared||realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||realpathSync(root)!==realpathSync(join(env.WFR_RUN_DIR,'runtime'))||readFrozen(env.WFR_RUN_DIR).snapshot_sha256!==frozen.snapshot_sha256)throw fail('SOURCE');
  assertAgentInput(frozen,env);assertFrozenNativeTaskLease(frozen);assertPreflightProfile({env,frozen});verifyRpcSource(source,{base:root});
  for(const f of source.files){const path=join(root,f.path),s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||hash(readFileSync(path))!==f.sha256)throw fail('SOURCE');}
 }
 async function prepare(){
  if(prepared)return;
  if(frozen?.execution_mode!=='agent'||frozen.execution_transport!=='raw-model-v1'||env.WF_BRAIN_WORKFLOW!=='douyin_video_discovery'||frozen.control_scope||!isPreflightRuntime(preflightRuntime))throw fail('UNSUPPORTED');
  input=assertAgentInput(frozen,env);lease=assertFrozenNativeTaskLease(frozen);spec=frozen.discovery_phone_scope;profile=assertPreflightProfile({env,frozen});
  if(!spec||input.task_id!==taskId||spec.serial!==input.serial||spec.profile!==input.profile||spec.run_id!==binding.run_id||spec.task_id!==taskId||spec.source_commit!==frozen.deployment.source_commit||!/^tcp:127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(spec.policy?.endpoint||''))throw fail('SCOPE');
  assertNativeTaskAssociation({frozen,binding,taskId,runDir:env.WFR_RUN_DIR,scope:spec,host:env.WFR_HOSTKEY});
  source=nativePhoneSource(frozen);policy=JSON.parse(readFileSync(join(root,'config/native-phone-command-sources.json')));
  const matches=policy.device_sources?.filter(r=>r.profile===input.profile&&r.serial===input.serial);
  if(policy.schema_version!==1||matches?.length!==1)throw fail('SOURCE');policy=matches[0];
  if(policy.package!=='com.ss.android.ugc.aweme'||policy.width!==profile.width||policy.height!==profile.height||!policy.pillow||requiredCommands.some(op=>!policy.commands?.includes(op)))throw fail('INCOMPLETE_COMMAND_POLICY');
  for(const row of [policy.review,policy.pillow])if(!row?.path||source.files.filter(f=>f.path===row.path&&f.sha256===row.sha256).length!==1)throw fail('SOURCE');
  makePool=poolFactory||createPreflightPoolFactory({runtimeRoot:root,frozen,env});
  mkdirSync(join(env.WFR_RUN_DIR,'native-phone'),{mode:0o700});prepared=true;verify();
 }
 async function readClaim(entry){
  verify();if(unsafe||!entry||entry.closed)throw fail('AUTHORITY',true);
  const proof=await entry.authority.readClaim(),projection=readNativeAuthorityProjection(proof,{request:entry.request,source});
  if(!nativeAuthorityProjectionMatches(projection,{source,scope:entry.scope}))throw fail('AUTHORITY',true);
  return projection;
 }
 async function bindOfficialAuthority({request,control,scope,directory}){
  verify();if(active||unsafe||judgeUnknown||seen.has(scope.activity)||!slots.includes(scope.activity)||scope.deadline_ms>lease.effective_deadline_ms||request.source_commit!==source.commit||request.runtime_snapshot_sha256!==frozen.snapshot_sha256)throw fail('SCOPE');
  if(scope.activity==='collect_videos'&&!seen.has('preflight')||scope.activity==='cleanup'&&!seen.has('preflight')&&!unstartedScope)throw fail('ORDER');
  for(const[a,b]of [['workflow','workflow_key'],['activity','activity_key'],['run','run_tag'],['run_id','run_id'],['task_id','task_id'],['binding_id','binding_id'],['profile','profile'],['serial','serial'],['line','line'],['source_run','source_run'],['limit','limit']])if(scope[a]!==request[b])throw fail('SCOPE');
  if(typeof control?.verifySealedExecution!=='function'||typeof control?.snapshot!=='function')throw fail('WORKER_CONTROL');
  const entry={scope:structuredClone(scope),request:structuredClone(request),workerControl:control,closed:false,unknown:false,commands:[],readers:[],epoch:++index};active=entry;entries.push(entry);seen.add(scope.activity);
  try{entry.authority=createNativeActivityAuthority({runtimeRoot:root,source,request:entry.request,frozen,directory,...(createAuthorityControl?{createControl:createAuthorityControl}:{})});await readClaim(entry);}catch(e){entry.unknown=true;unsafe=true;throw e;}
 }
 async function resources(entry){
  if(active!==entry||entry.closed||entry.unknown||Date.now()>=entry.scope.worker_deadline_ms)throw fail('CLOSED',entry.unknown);
  await readClaim(entry);if(entry.guard)await entry.guard();await readClaim(entry);return true;
 }
 const directory=(entry,name)=>{const path=join(entry.directory,name);mkdirSync(path,{mode:0o700});return path;};
 const diagnostic=(entry,name,value)=>{
  const fd=openSync(join(entry.directory,name),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify({schema_version:1,scope:entry.commandScope,observed_at:new Date().toISOString(),...value})+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  const dir=openSync(entry.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(dir);}finally{closeSync(dir);}
 };
 async function prepareIngress(entry){
  if(entry.ready)return;await resources(entry);
  entry.directory=join(env.WFR_RUN_DIR,'native-phone',entry.scope.activity);mkdirSync(entry.directory,{mode:0o700});
  const base={task_id:taskId,binding_id:binding.id,run_id:binding.run_id,source_commit:source.commit,profile:input.profile,serial:input.serial,epoch:entry.epoch,endpoint:spec.policy.endpoint,claim:frozen.native_claim,worker_deadline_ms:entry.scope.worker_deadline_ms,cleanup_deadline_ms:entry.scope.receipt_deadline_ms};
  entry.readScope={...base,protocol:'native-phone-adb-read/v1'};entry.commandScope={...base,protocol:'adb-shell-v2-observation/v1'};
  const authority=q=>async()=>{const p=await readClaim(entry);if(entry.guard)await entry.guard();return {scope:q,claimed_by:p.claimed_by,claimed_at:p.claimed_at,lease_until:new Date(Math.min(lease.effective_deadline_ms,entry.scope.receipt_deadline_ms)).toISOString()};};entry.wireAuthority=authority;
  entry.context={profile:input.profile,serial:input.serial,package:'com.ss.android.ugc.aweme',width:profile.width,height:profile.height,keywords:frozen.discovery_input.sources.map(s=>typeof s==='string'?s:s.source||s.keyword),evidenceRoot:spec.evidence_root,run:input.run_tag,deviceSdk:policy.device_sdk,detailPlayback:'continuous_identity'};
  const reader=createNativePhoneAdbRead({runtimeRoot:root,source,directory:directory(entry,'source'),scope:entry.readScope,readAuthority:authority(entry.readScope)});entry.readers.push(reader);
  entry.sourceIssuer=createNativePhoneSourceIssuer({runtimeRoot:root,source,scope:entry.readScope,context:entry.context,reader});entry.commandSource=await entry.sourceIssuer.prepare();
  const reviewed=readNativePhoneCommandSource(entry.commandSource),pillow={path:join(root,reviewed.pillow.path),sha256:reviewed.pillow.sha256};
  entry.local=await startNativePhoneLocalProducer({root,source,scope:entry.scope,directory:directory(entry,'local'),python:spec.executables.python,pillow,deadlineMs:entry.scope.worker_deadline_ms,receiptDeadlineMs:entry.scope.receipt_deadline_ms,assertResources:()=>resources(entry)});
  entry.ready=true;
  const sdk=await command('sdk'),actual=sdk.stdout.toString().replaceAll('\r','').trim(),matches=sdk.code===0&&actual===String(policy.device_sdk);
  diagnostic(entry,'sdk.outcome.json',{operation:'sdk',expected_sdk:policy.device_sdk,actual_sdk:/^[0-9]{1,5}$/.test(actual)?actual:null,exit_code:sdk.code,wire_complete:sdk.wire_complete,error_code:matches?null:'NATIVE_PHONE_SDK_SCOPE',remote_execution_stopped:'not_attested'});
  if(!matches)throw fail('SDK_SCOPE');
 }
 async function command(operation,args=[]){
  const entry=active;if(!entry?.ready)throw fail('NOT_PREPARED');await resources(entry);
  const commandIndex=entry.commands.length,observer=createNativePhoneCommandObserver({runtimeRoot:root,source,directory:directory(entry,'command-'+commandIndex),scope:entry.commandScope,commandSource:entry.commandSource,operation,args,context:{...entry.context,originalIme:entry.originalIme},readAuthority:entry.wireAuthority(entry.commandScope)});entry.commands.push(observer);
  let result,error,stop,closeError;
  try{const cap=await observer.observeDump();result=observer.readReviewedCommandReceipt(cap,{scope:entry.commandScope});entry.commandReceipts??=[];entry.commandReceipts.push({observer,cap});if(operation==='current-ime'&&result.code===0&&!entry.originalIme)entry.originalIme=result.stdout.toString().trim();await resources(entry);}
  catch(e){entry.unknown=true;unsafe=true;error=Object.assign(fail('COMMAND_UNKNOWN',true),{cause:e});}
  try{stop=await observer.close();}catch(e){closeError=e;stop=observer.snapshot();}
  if(closeError||stop.unknown||stop.pending||stop.open_sockets){entry.unknown=true;unsafe=true;if(!error)error=Object.assign(fail('COMMAND_CLOSE_UNKNOWN',true),{cause:closeError});}
  try{diagnostic(entry,`command-${commandIndex}.native.json`,{operation,error_code:error?.code??null,wire_error_code:error?.cause?.code??null,close_error_code:closeError?.code??null,wire_snapshot:stop,remote_execution_stopped:'not_attested'});}
  catch(e){entry.unknown=true;unsafe=true;throw Object.assign(fail('COMMAND_DIAGNOSTICS_UNKNOWN',true),{cause:error||e});}
  if(error)throw error;return result;
 }
 async function readEvidence(path){
  const entry=active;if(!entry?.ready)throw fail('NOT_PREPARED');await resources(entry);
  const reader=createNativePhoneEvidenceRead({runtimeRoot:root,source,directory:directory(entry,'evidence-'+entry.readers.length),scope:entry.readScope,commandSource:entry.commandSource,readAuthority:entry.wireAuthority(entry.readScope)});entry.readers.push(reader);
  try{const cap=await reader.read(path),r=reader.readReceipt(cap,{scope:entry.readScope});await resources(entry);return r.bytes;}catch(e){entry.unknown=true;unsafe=true;throw fail('READ_UNKNOWN',true);}finally{const stop=await reader.close();if(!stop.channel_stopped){entry.unknown=true;unsafe=true;throw fail('READ_CLOSE_UNKNOWN',true);}}
 }
 async function local(name,payload){const entry=active;await resources(entry);try{return await entry.local.local(name,payload);}catch(e){if(nativePhoneLocalFailureReturned(e)){e.returned=true;e.executionStopped=true;}else{entry.unknown=true;unsafe=true;}throw e;}}
 async function wait(ms){const entry=active;await resources(entry);if(!Number.isSafeInteger(ms)||ms<0||Date.now()+ms>=entry.scope.worker_deadline_ms)throw fail('DEADLINE');await new Promise(r=>setTimeout(r,ms));await resources(entry);}
 async function primeXml(xml){const entry=active;await resources(entry);const parsed=await local('native-phone-link-step.py',{operation:'metrics-descriptions',xml});cache.set(hash(xml),parsed);return true;}
 function readVisionCredential(){
  // Deployment refreshes this private 1Password cache; never serialize its
  // bytes into Source, model prompts, journals, errors or transport metadata.
  const home=realpathSync(env.HOME),folder=join(home,'.credentials'),path=join(folder,'openrouter.env'),d=lstatSync(folder);
  if(realpathSync(folder)!==folder||!d.isDirectory()||d.uid!==process.getuid()||(d.mode&0o077))throw fail('VISION_CREDENTIAL');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const a=fstatSync(fd),b=readFileSync(fd),z=fstatSync(fd),now=lstatSync(path);if(!a.isFile()||a.uid!==process.getuid()||(a.mode&0o777)!==0o600||a.nlink!==1||b.length>65536||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==now[k]))throw fail('VISION_CREDENTIAL');const rows=b.toString().split(/\r?\n/).map(v=>v.trim()).filter(v=>v&&!v.startsWith('#')).filter(v=>/^(?:export )?OPENROUTER_API_KEY=/.test(v));if(rows.length!==1)throw fail('VISION_CREDENTIAL');let token=rows[0].replace(/^(?:export )?OPENROUTER_API_KEY=/,'');if((token.startsWith('"')&&token.endsWith('"'))||(token.startsWith("'")&&token.endsWith("'")))token=token.slice(1,-1);if(!/^[A-Za-z0-9_.-]{8,2048}$/.test(token))throw fail('VISION_CREDENTIAL');return token;}finally{closeSync(fd);}
 }
 async function startMacros(entry){
  const foreground=async()=>{const r=await command('foreground');if(r.code!==0)throw fail('FOREGROUND');return firstNativePhoneFocus(r.stdout.toString());};
  const macroCommand=async(op,args=[])=>{const r=await command(op,args);if(r.code!==0)throw Object.assign(fail('COMMAND_FAILED'),{returned:true});return r.stdout.toString();};
  const io={command,readEvidence,foreground,wait,local};entry.ui=createNativePhoneUi({context:entry.context,io});
  const macroIo={...io,command:macroCommand,captureXml:entry.ui.captureXml,snapshot:entry.ui.snapshot,publishXml:entry.ui.publishXml,locate:params=>entry.vision.locate(params)};entry.search=createNativePhoneSearchMacros({context:entry.context,io:macroIo});
  const {startNativePhoneLinkResolver}=await import('./native-phone-link-resolver.mjs');entry.resolver=await startNativePhoneLinkResolver({root,source,scope:entry.scope,deadlineMs:entry.scope.worker_deadline_ms,receiptDeadlineMs:entry.scope.receipt_deadline_ms,assertResources:()=>resources(entry),...(requestImpl?{requestImpl}:{})});
  entry.vision=startNativePhoneVision({root,source,scope:entry.scope,context:{run:input.run_tag,width:profile.width,height:profile.height},directory:directory(entry,'vision'),deadlineMs:entry.scope.worker_deadline_ms,receiptDeadlineMs:entry.scope.receipt_deadline_ms,assertResources:()=>resources(entry),credential:visionCredential||readVisionCredential,prepareImage:async(raw,{artifact})=>{if(artifact.ext!=='png'||hash(raw)!==artifact.sha256)throw fail('VISION_IMAGE');const value=await local('native-phone-vision-step.py',{operation:'encode',path:artifact.path,sha256:artifact.sha256});if(typeof value.image_b64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.image_b64))throw fail('VISION_IMAGE');return {bytes:Buffer.from(value.image_b64,'base64'),mime:value.mime,width:value.width,height:value.height};},io:{snapshot:entry.ui.snapshot,readArtifact:entry.ui.readArtifact,wait},...(requestImpl?{requestImpl}:{})});
  entry.clip=createNativePhoneClipState({home:env.HOME,profile:input.profile,assertResources:()=>resources(entry)});
  entry.link=createNativePhoneLinkMacros({context:entry.context,io:{...macroIo,resolveShareLink:entry.resolver.resolveShareLink,writeEvidence:entry.ui.writeEvidence,readClipState:entry.clip.read,writeClipState:entry.clip.write,restoreResults:async(keyword,eid)=>{const raw=await entry.search.run('back-to-results',['5',keyword,eid]);if(!/^back_to_results=1 backs=[0-5](?: recovered_via=research)?\n$/.test(raw))throw fail('RESULTS_RESTORE_UNVERIFIED');return {verified:true,...(raw.includes('recovered_via=research')?{recovered_via:'research'}:{})};},primeMetrics:async artifact=>{const r=entry.ui.readArtifact(artifact);if(r.ext!=='xml')throw fail('METRICS_ARTIFACT');return primeXml(r.bytes.toString());}}});
 }
 async function prepareActivity(scope,ctx){
  verify();if(!active||canonical(active.scope)!==canonical(scope))throw fail('SCOPE');active.guard=()=>ctx.assertResources(scope);
  if(scope.activity!=='collect_videos')return;
  const handoff=issuePreflightPhoneHandoff(preflightRuntime,scope);active.handoff=()=>readPreflightPhoneHandoff(handoff,{runtime:preflightRuntime,scope});const guard=active.guard;active.guard=async()=>{active.handoff();await guard();};
  await prepareIngress(active);await startMacros(active);
  const deps={nativeMetrics,prepareMetrics:primeXml};active.queue=createNativePhoneQueue({root,source,scope,directory:directory(active,'queue'),createPool:makePool,assertAuthority:()=>readClaim(active),queueDependencies:deps});await active.queue.prepare();await active.queue.begin(scope);
 }
 async function preparePreflight(scope,ctx){
  const entry=active;if(!entry||canonical(entry.scope)!==canonical(scope)||!['preflight','cleanup'].includes(scope.activity))throw fail('SCOPE');entry.guard=ctx.assertResources;await prepareIngress(entry);
  const {createNativePhonePreflightAdapter}=await import('./native-phone-preflight-adapter.mjs');entry.adapter=createNativePhonePreflightAdapter({context:{owner:input.run_tag,evidenceRoot:spec.evidence_root,width:profile.width,height:profile.height,purpose:scope.activity,deadlineMs:scope.worker_deadline_ms},io:{command,readEvidence},hostAdb:ctx.hostAdb});return entry.adapter.adb;
 }
 async function phone(name,...args){
  const entry=active;if(!entry?.ready||entry.scope.activity!=='collect_videos')throw fail('SCOPE');await resources(entry);
  if(name==='lock-refresh'){if(args.length!==1||args[0]!==input.run_tag)throw fail('SCOPE');await preflightRuntime.refreshOwned(scopeFor(entry));return 'lock=refreshed\n';}
  if(entry.search.commands.includes(name))return entry.search.run(name,args);
  if(entry.link.commands.includes(name))return entry.link.run(name,args);
  if(name==='foreground'&&!args.length)return 'foreground='+firstNativePhoneFocus((await command('foreground')).stdout.toString())+'\n';
  if(name==='tap-evidence'&&args.length===3){await command('tap',args.slice(0,2));await wait(3000);const shot=await entry.ui.snapshot(args[2]);return `tapped=${args[0]} ${args[1]}\nevidence=${shot.path}\n`;}
  if(name==='ui-evidence'&&args.length===1)return (await entry.ui.captureXml(args[0])).path+'\n';
  if(name==='snapshot-evidence'&&args.length===1)return (await entry.ui.snapshot(args[0])).path+'\n';
  throw fail('UNSUPPORTED_COMMAND');
 }
 const scopeFor=e=>e.scope;
 async function queue(op,fields){
  if(!active?.queue||!fields||Object.getPrototypeOf(fields)!==Object.prototype)throw fail('QUEUE_SCOPE');
  const payload={...fields};
  // The common Agent tools append these Code scope fields after native input
  // validation. Validate each one before removing it; the private queue still
  // accepts only its original finite business payload.
  for(const [key,value]of Object.entries({line:active.scope.line,run:active.scope.run,source_run:active.scope.source_run,limit:active.scope.limit}))if(Object.hasOwn(payload,key)){if((key==='source_run'?(payload[key]??null):payload[key])!==value)throw fail('QUEUE_SCOPE');delete payload[key];}
  return active.queue.queue(op,payload);
 }
 async function closeActivity(proof,scope){
  const entry=active;if(!entry){if(scope&&skillLaunchDidNotStart(proof,scope)&&preflightRuntime.zeroLocalStart(scope))unstartedScope=structuredClone(scope);return {execution_stopped:!unsafe};}entry.modelStopped=skillLaunchDidNotStart(proof,entry.scope)||proof?.execution_stopped===true&&rawModelScopeStopped(proof.raw_model_proof,entry.scope);
  if(skillLaunchDidNotStart(proof,entry.scope))try{entry.workerControl.seal(entry.request);await entry.workerControl.close();}catch{entry.unknown=true;}
  try{entry.modelStopped &&= entry.workerControl.verifySealedExecution(entry.workerControl.snapshot(),{request:entry.request})===true;}catch{entry.modelStopped=false;}
  entry.adapter?.seal();entry.ui?.seal();entry.search?.seal?.();
  let stopped=true;
  if(entry.queue)try{await entry.queue.closeActivity();stopped=(await entry.queue.close()).execution_stopped===true&&stopped;entry.queueReceipts=entry.queue.issuedReceipts();}catch{stopped=false;}
  if(entry.vision)try{const p=await entry.vision.close();stopped=entry.vision.verifyStopped(p)&&stopped;}catch{stopped=false;}
  if(entry.resolver)try{const p=await entry.resolver.close();stopped=entry.resolver.verifyStopped(p)&&stopped;}catch{stopped=false;}
  if(entry.local)try{const p=await entry.local.close();stopped=entry.local.verifyStopped(p)&&stopped;}catch{stopped=false;}
  for(const observer of entry.commands)try{const p=await observer.close();stopped=!p.unknown&&!p.pending&&!p.open_sockets&&stopped;}catch{stopped=false;}
  for(const reader of entry.readers)try{stopped=(await reader.close()).channel_stopped===true&&stopped;}catch{stopped=false;}
  if(entry.sourceIssuer)try{await entry.sourceIssuer.close();}catch{stopped=false;}
  try{const p=await entry.authority.close();stopped=entry.authority.verifyStopped(p)&&stopped;}catch{stopped=false;}
  entry.closed=true;entry.unknown||=!stopped||!entry.modelStopped||entry.clip?.snapshot().unknown===true;unsafe||=entry.unknown;active=null;entry.stop={domain:'native-phone-activity/v1',activity:entry.scope.activity,execution_stopped:stopped&&!entry.unknown&&entry.modelStopped,model_stopped:entry.modelStopped,external_effect:entry.queue?.snapshot().external_effect||'none'};return {...entry.stop};
 }
 async function readbackChecks(activity,{metrics,deadlineMs,signal}={}){
  verify();const entry=entries.find(e=>e.scope.activity===activity);
  if(activity!=='collect_videos'||active||unsafe||judgeUnknown||!entry?.closed||entry.stop?.execution_stopped!==true||entry.modelStopped!==true||signal?.aborted)throw fail('JUDGE_PREVIOUS_STOP',true);
  entry.readbacks=(entry.readbacks||0)+1;if(entry.readbacks>2)throw fail('JUDGE_BUDGET');
  const path=join(env.WFR_RUN_DIR,'native-phone','readback-'+entry.readbacks);mkdirSync(path,{mode:0o700});
  const end=Math.min(deadlineMs??entry.scope.receipt_deadline_ms-1,entry.scope.receipt_deadline_ms-1);if(Date.now()>=end)throw fail('JUDGE_DEADLINE');
  let authority,producer,result,stopped=true;
  try{
   authority=createNativeActivityAuthority({runtimeRoot:root,source,request:entry.request,frozen,directory:path,...(createAuthorityControl?{createControl:createAuthorityControl}:{})});
   const claim=async()=>{verify();if(signal?.aborted||Date.now()>=end)throw fail('JUDGE_DEADLINE');const proof=await authority.readClaim(),p=readNativeAuthorityProjection(proof,{request:entry.request,source});if(!nativeAuthorityProjectionMatches(p,{source,scope:entry.scope}))throw fail('JUDGE_AUTHORITY');return p;};
   const localPath=join(path,'local');mkdirSync(localPath,{mode:0o700});
   producer=await startNativePhoneLocalProducer({root,source,scope:entry.scope,directory:localPath,python:spec.executables.python,deadlineMs:end,receiptDeadlineMs:entry.scope.receipt_deadline_ms,assertResources:async()=>{await claim();return true;}});
   const readerCache=new Map(),readerMetrics={parseDescriptions(xml){const v=readerCache.get(hash(xml));if(!v)throw fail('JUDGE_METRICS_UNPRIMED');return structuredClone(v);}};
   const prepareMetrics=async xml=>{await claim();const value=await producer.local('native-phone-link-step.py',{operation:'metrics-descriptions',xml});readerCache.set(hash(xml),value);await claim();};
   const {doc,errors}=require('./checks/probes-lib.js').loadChecks(join(root,'checks/douyin-video-discovery.yaml'),join(root,'checks/schema.json')),steps=JSON.parse(readFileSync(join(root,'plans/douyin_video_discovery.steps.json')));if(errors.length)throw fail('JUDGE_CHECKS');
   const queuePath=join(path,'queue');mkdirSync(queuePath,{mode:0o700});
   result=await readNativePhoneQueueActivity({root,source,scope:entry.scope,records:entry.queueReceipts,directory:queuePath,createPool:makePool,assertAuthority:claim,queueDependencies:{nativeMetrics:readerMetrics,prepareMetrics},deadlineMs:end,checks:{doc,spec:steps},metrics:{persisted:metrics.persisted,videos_pushed:metrics.videos_pushed}});
   const original=readNativePhoneQueueReceipts(entry.queueReceipts,{source,scope:entry.scope});
   const archives=await discoveryMetrics.verifyArchivedObservations({videos:original.videos,runDir:env.WFR_RUN_DIR,scope:{run:input.run_tag,run_id:binding.run_id,profile:input.profile,source_commit:source.commit,line_key:require('./line-routes.js').routeOf(input.line).key},nativeMetrics:readerMetrics,readback:async video=>result.result.readbacks.observations.find(row=>row.video_id===(video.videoId??video.video_id))?.result});
   result.result.metrics.discovery_metrics_verified=Number(archives&&result.result.metrics.discovery_metrics_verified===1);
   const allMetrics={...metrics,...result.result.metrics},local=await runProbes({doc:{...doc,probes:doc.probes.filter(p=>p.probe.type==='metric')},stage:activity,params:{metrics:allMetrics,runTag:input.run_tag,lineKey:input.line,word:''},deps:{},timeoutMs:Math.max(1,end-Date.now())});
   result.result.probes=[...(result.result.probes||[]),...local.probes];result.result.metrics=allMetrics;
  }catch(e){judgeUnknown=true;throw e;}
  finally{
   if(producer)try{const p=await producer.close();stopped=producer.verifyStopped(p)&&stopped;}catch{stopped=false;}
   if(authority)try{const p=await authority.close();stopped=authority.verifyStopped(p)&&stopped;}catch{stopped=false;}
   if(!stopped)judgeUnknown=true;
  }
  if(!stopped||result.result.code_native_readback.execution_stopped!==true){judgeUnknown=true;throw fail('JUDGE_STOP_UNKNOWN',true);}
  result.result.code_native_readback.authority_execution_stopped=true;return result;
 }
 const api={prepare,readbackChecks,bindOfficialAuthority,prepareActivity,preparePreflight,phone,queue,closeActivity,nativeMetrics,source:()=>structuredClone(source),supports(activity){try{verify();return !unsafe&&!judgeUnknown&&!active&&!seen.has(activity.key)&&slots.includes(activity.key);}catch{return false;}},nativeState:()=>({execution_unknown:unsafe||judgeUnknown||entries.some(e=>e.unknown),native_stop_unproven:unsafe||judgeUnknown,external_effect:entries.some(e=>e.queue?.snapshot().external_effect==='unknown')?'unknown':'observed'}),snapshot:()=>({prepared,unsafe,active:active?.scope.activity||null,activities:entries.map(e=>({activity:e.scope.activity,closed:e.closed,ready:e.ready===true,unknown:e.unknown}))})};
 cleanupRoutes.set(api,request=>{
  verify();const previous=entries.at(-1),fixed=frozen.workflow_version?.payload?.contract;
  if(unsafe||judgeUnknown||active||!fixed?.always_run?.includes('cleanup')||seen.has('cleanup')||!(previous?.closed&&previous.stop?.execution_stopped===true&&previous.modelStopped===true||unstartedScope&&preflightRuntime.zeroLocalStart(unstartedScope))||request?.activity_key!=='cleanup'||request.execution_transport!=='raw-model-v1'||request.runtime_snapshot_sha256!==frozen.snapshot_sha256||request.deadline_ms>lease.effective_deadline_ms||Date.now()>=request.worker_deadline_ms)throw fail('CLEANUP_ROUTE');
  for(const [key,value]of Object.entries({task_id:taskId,binding_id:binding.id,run_id:binding.run_id,source_commit:source.commit,workflow_key:input.workflow_key,profile:input.profile,serial:input.serial,run_tag:input.run_tag,line:input.line,source_run:input.source_run,limit:input.limit}))if(request[key]!==value)throw fail('CLEANUP_ROUTE');
  // This fact only allows the existing Router's always_run cleanup slot. The
  // next Observer and Worker still independently authorize the new request.
  return true;
 });
 runtimes.add(api);return Object.freeze(api);
}
