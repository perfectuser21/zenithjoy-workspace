import {readFileSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createPhoneEpochGuard} from './phone-epoch-admission.mjs';
import {deploymentTarget} from './runtime-host.mjs';
const records=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const selectedEnv=e=>Object.fromEntries(['HOME','WFR_RUN_DIR','P','SERIAL','WFR_TAG','DOUYIN_PHONE_LOCK_ROOT','DOUYIN_PHONE_REGISTRY','ADB_SERVER_SOCKET','DOUYIN_ADB_PORT','ZJ_ADB_HOST_CONFIG'].map(k=>[k,e?.[k]]));
const key=c=>canonical({root:c.root,frozen:c.frozen,scope:c.scope,binding:c.binding,taskId:c.taskId,env:selectedEnv(c.env)});
const fail=code=>Object.assign(Error('PHONE_OPERATION_'+code),{code:'PHONE_OPERATION_'+code,resourceUnknown:true,externalEffect:'unknown'});
export function phoneOperationKind(spec){
 const p=spec?.policy,u=spec?.policy_binding?.usb_local;
 if(p?.schema_version===2)return 'cloud-epoch';
 return p?.schema_version===1&&spec.target==='xian-m4'&&spec.profile==='xiaolongxia'&&spec.serial==='ANGYVB4311010223'&&spec.expected_account==='90915521618'
  &&p.host_id==='xian-m4'&&p.transport==='usb'&&p.endpoint==='tcp:127.0.0.1:5037'&&canonical(p.forbidden_ports)===canonical([5041,5042])
  &&u?.protocol==='usb-local-lease/v1'&&u.device_sdk===35&&u.transport?.serial===spec.serial&&typeof u.transport.transport_id==='string'&&/^[1-9]\d*$/.test(u.transport.transport_id)
  &&typeof u.transport.usb_path==='string'&&/^[-0-9.]+$/.test(u.transport.usb_path)&&u.daemon?.endpoint===p.endpoint?'usb-local':null;
}
export function isPhoneOperationAdmission(value,context){try{return records.has(value)&&records.get(value)===key(context);}catch{return false;}}
export function createPhoneOperationAdmission(context,dependencies={}){
 const {root,env,frozen,state={},scope,binding,taskId,assertAuthority}=context;
 const fixed=structuredClone(frozen),spec=fixed.discovery_phone_scope||fixed.collection_phone_scope,identity=key(context),input=fixed.agent_input;
 const kind=phoneOperationKind(spec);
 if(!kind||typeof assertAuthority!=='function'||!scope||scope.task_id!==taskId||input?.task_id!==taskId||scope.run_id!==binding?.run_id||scope.binding_id!==binding?.id
  ||scope.source_commit!==fixed.deployment?.source_commit||scope.snapshot_sha256!==fixed.snapshot_sha256||scope.profile!==spec?.profile||scope.serial!==spec?.serial||scope.profile!==input.profile||scope.serial!==input.serial||env.P!==input.profile||env.SERIAL!==input.serial||scope.run!==input.run_tag||env.WFR_TAG!==input.run_tag||spec.run_id!==binding.run_id
  ||![scope.worker_deadline_ms,scope.receipt_deadline_ms,scope.deadline_ms].every(Number.isSafeInteger)||scope.worker_deadline_ms>=scope.receipt_deadline_ms||scope.receipt_deadline_ms>=scope.deadline_ms)throw fail('SCOPE');
 const usb=spec.policy_binding?.usb_local,policy=spec.policy;
 const epoch=kind==='cloud-epoch'?createPhoneEpochGuard({root,env,frozen,state,deadlineMs:scope.worker_deadline_ms}):null;
 let readDaemon=dependencies.readDaemon,startDomain=dependencies.startDomain,inventory=dependencies.inventory,domainClosure=dependencies.domainClosure,parseDeviceInventory,assertPreflightProfile;
 const actualHost=dependencies.actualHost??(()=>deploymentTarget(hostname()));
 let prepared=false,preparing,closed=false,unknown=false,domain,closing,lockIdentity,sdkVerified=false,sequence=0,domainStopped=false;
 const directory=join(env.WFR_RUN_DIR,'phone-operation-admission-'+scope.activity+'-'+randomUUID());
 const current=(action=true)=>{
  if(closed||unknown||action&&state.executionUnknown||key(context)!==identity||Date.now()>=(action?scope.worker_deadline_ms:scope.receipt_deadline_ms))throw fail('CLOSED_OR_CHANGED');
 };
 function source(){
  if(realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||actualHost()!=='xian-m4')throw fail('USB_HOST');
  for(const [name,expected]of Object.entries(fixed.files).filter(([p])=>p.startsWith('runtime/'))){
   if(name.split('/').some(p=>!p||p==='.'||p==='..'))throw fail('SOURCE');
   const path=join(root,name.slice(8)),s=lstatSync(path);
   if(!s.isFile()||s.isSymbolicLink()||realpathSync(path)!==path||s.mode&0o022||sha(readFileSync(path))!==expected)throw fail('SOURCE');
  }
  for(const name of ['phone-operation-admission.mjs','preflight-native-domain.mjs','collection-leaf-producer.mjs','config/collection-phone-hosts.json','config/native-phone-command-sources.json'])if(!fixed.files['runtime/'+name])throw fail('SOURCE');
  const hosts=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.filter(h=>h.profile===spec.profile&&h.serial===spec.serial&&h.target===spec.target);
  if(hosts.length!==1||canonical(hosts[0].policy)!==canonical(policy)||hosts[0].expected_account!==spec.expected_account)throw fail('USB_REGISTRY');
  const rows=JSON.parse(readFileSync(join(root,'config/native-phone-command-sources.json'))).device_sources.filter(r=>r.profile===spec.profile&&r.serial===spec.serial);
  if(rows.length!==1||rows[0].device_sdk!==35||fixed.files['runtime/'+rows[0].review.path]!==rows[0].review.sha256||sha(readFileSync(join(root,rows[0].review.path)))!==rows[0].review.sha256)throw fail('USB_REVIEW');
  const profile=assertPreflightProfile({env,frozen:fixed});if(profile.width!==rows[0].width||profile.height!==rows[0].height)throw fail('USB_REVIEW');
  const path=usb.daemon.policy_path,s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||s.nlink!==1||realpathSync(path)!==path)throw fail('USB_POLICY');
  const raw=readFileSync(path),actual=JSON.parse(raw);
  if(sha(raw)!==usb.daemon.policy_sha256||['schema_version','host_id','transport','endpoint','forbidden_ports','adb_bin'].some(k=>canonical(actual[k])!==canonical(policy[k]))
   ||usb.daemon.executable!==policy.adb_realpath||usb.daemon.executable_sha256!==policy.adb_sha256)throw fail('USB_POLICY');
  readDaemon(usb.daemon);
 }
 function owner(){
  const path=join(env.DOUYIN_PHONE_LOCK_ROOT||join(env.HOME,'.local/share/zenithjoy/phone-locks'),spec.serial+'.lock'),s=lstatSync(path),guard=lstatSync(path.slice(0,-5)+'.guard'),p=join(path,'owner'),o=lstatSync(p);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o022||realpathSync(path)!==path||!guard.isFile()||guard.isSymbolicLink()||guard.uid!==process.getuid()||(guard.mode&0o777)!==0o600
   ||!o.isFile()||o.isSymbolicLink()||o.uid!==process.getuid()||o.mode&0o022||readFileSync(p,'utf8').trim()!==input.run_tag)throw fail('USB_OWNER');
  const now=canonical({directory:[s.dev,s.ino],guard:[guard.dev,guard.ino],owner:[o.dev,o.ino]});
  if(lockIdentity&&lockIdentity!==now)throw fail('USB_OWNER_CHANGED');lockIdentity=now;
 }
 async function authority(request,action=true){
  current(action);const proof=await assertAuthority(request);current(action);
  if(proof?.authorized!==true||kind==='usb-local'&&(!fixed.native_claim||fixed.native_claim.claimed_by!=='common-runner'||!Number.isFinite(Date.parse(fixed.native_claim.claimed_at))||canonical(proof.claim)!==canonical(fixed.native_claim)))throw fail('AUTHORITY');
  if(kind==='usb-local'&&request.phase!=='prepare'&&!(request.phase==='close'&&request.resourceOnly===true)){
   const c=proof.central;
   if(c?.device_name!==spec.serial||c.locked_by!==taskId||c.expired!==false||!/^\d+$/.test(c.lease_version||'')||!Number.isFinite(Date.parse(c.expires_at))||Date.parse(c.expires_at)<=Date.now()+1000)throw fail('CENTRAL');
  }
  return proof;
 }
 async function guard(request={phase:'native',resourceOnly:false}){
  const proof=await authority(request);source();if(!request.resourceOnly)owner();current();
  if(!request.resourceOnly){
   const out=join(directory,'inventory-'+String(++sequence).padStart(4,'0'));mkdirSync(out,{mode:0o700});
   const q={endpoint:policy.endpoint,serial:spec.serial};
   const result=await inventory({operation:'inventory',scope:q,directory:out,checkOperationTime:()=>current(),readAuthority:async()=>{current();source();owner();return {scope:q,authorized_action:'inventory',lease_until:proof.central.expires_at};}});
   current();source();owner();await authority(request);current();source();owner();current();
   if(result.wire_complete!==true||result.socket_closed!==true||result.peer_eof!==true||result.pending!==0)throw fail('USB_INVENTORY_UNKNOWN');
   const rows=parseDeviceInventory(result.response).filter(x=>x.serial===spec.serial),properties=rows[0]?.properties?.split(/\s+/)||[];
   if(rows.length!==1||rows[0].state!=='device'||!properties.includes('transport_id:'+usb.transport.transport_id)||!properties.includes('usb:'+usb.transport.usb_path))throw fail('USB_TRANSPORT');
  }
  return proof;
 }
 const taint=error=>{unknown=true;state.executionUnknown=true;return Object.assign(error,{resourceUnknown:true,externalEffect:'unknown'});};
 async function prepare(){
  if(preparing)return preparing;
  preparing=(async()=>{try{
   current();
   if(kind==='cloud-epoch'){await authority({phase:'prepare',resourceOnly:true});prepared=true;return true;}
   const [daemon,transport,producer,profile]=await Promise.all([import('./device-epoch-fence-admission.mjs'),import('./device-epoch-fence-transport.mjs'),import('./preflight-native-domain.mjs'),import('./preflight-control-scope.mjs')]);
   readDaemon??=daemon.readBoundAdbDaemon;inventory??=transport.hostOperation;parseDeviceInventory=transport.parseDeviceInventory;startDomain??=producer.startPreflightNativeDomain;domainClosure??=producer.preflightDomainClosure;assertPreflightProfile=profile.assertPreflightProfile;
   source();await authority({phase:'prepare',resourceOnly:true});source();mkdirSync(directory,{mode:0o700});
   writeFileSync(join(directory,'policy.json'),JSON.stringify(policy),{flag:'wx',mode:0o600});
   domain=await startDomain({root,directory,sourceFiles:Object.fromEntries(Object.entries(fixed.files).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h])),python:spec.executables.python,policy,serial:spec.serial,workerDeadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms,env,assertAdmission:async()=>{try{return await guard();}catch(error){throw taint(error);}}});
   current();source();prepared=true;return true;
  }catch(error){throw taint(error);}})();return preparing;
 }
 async function admit(request={phase:'native',resourceOnly:false}){
  try{
   if(kind==='cloud-epoch'){current();await authority(request);prepared=true;return request.resourceOnly?{authorized:true}:await epoch();}
   await prepare();current();
   const proof=await guard(request);
   if(!request.resourceOnly&&!sdkVerified){const sdk=(await domain.adb('shell','getprop','ro.build.version.sdk')).trim();if(sdk!=='35')throw fail('USB_SDK');sdkVerified=true;await guard(request);}
   return Object.freeze({authorized:true,kind,...(proof.central?{central:structuredClone(proof.central)}:{})});
  }catch(error){throw taint(error);}
 }
 const api=Object.freeze({kind,prepare,assert:admit,environment(){current();if(!prepared)throw fail('NOT_PREPARED');return kind==='usb-local'?{...domain.environment(),WFR_COLLECTION_POLICY_FILE:join(directory,'policy.json')}:{ };},close:()=>closing??=(async()=>{
  if(closed)return api.snapshot();
  if(kind==='cloud-epoch'){closed=true;return api.snapshot();}
  if(preparing)try{await preparing;}catch{unknown=true;state.executionUnknown=true;}
  if(domain)try{const proof=await domain.close();if(proof.execution_stopped!==true||proof.pending!==0||!domainClosure(domain))throw fail('USB_CLOSE_UNKNOWN');domainStopped=true;}catch{unknown=true;state.executionUnknown=true;}
  try{if(prepared){current(false);if(kind==='usb-local'){source();await authority({phase:'close',resourceOnly:true},false);source();}current(false);}}
  catch{unknown=true;state.executionUnknown=true;}finally{closed=true;}
  return api.snapshot();
 })(),snapshot:()=>Object.freeze({kind,prepared,sealed:closed,unknown,pending:domain?.snapshot().pending??0,execution_stopped:closed&&!unknown&&(domain===undefined||domainStopped)})});
 records.set(api,identity);return api;
}
