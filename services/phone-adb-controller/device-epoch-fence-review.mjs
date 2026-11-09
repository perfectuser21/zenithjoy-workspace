// 设备epoch维护只读入口。没有disconnect、start-server、解锁或历史状态写回入口。
import {lstatSync,readdirSync,realpathSync,mkdirSync,openSync,closeSync,constants,fsyncSync} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';
import {userInfo} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bytes,canonical,digest as sha,writeAll,FENCE_ACTIONS,approvalScopeFor} from './device-epoch-fence-reference.mjs';
export {bytes};
import {execFileSync} from 'node:child_process';
import {runDiagnostic,DIAGNOSTIC_COMMANDS,SUPPLEMENTAL_DIAGNOSTIC_COMMANDS,PROCESS_DIAGNOSTIC_COMMANDS} from './device-epoch-fence-diagnostics.mjs';
import {readFrozen,validateFrozenProjection} from './device-epoch-fence-public-snapshot.mjs';
export {validateFrozenProjection};
import {readReleaseProof} from './device-epoch-fence-central.mjs';
const here=dirname(fileURLToPath(import.meta.url)),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};

export function readOldDaemon({home=userInfo().homedir,endpoint,policy}){
 const port=endpoint.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/)?.[1];need(port,'OLD_DAEMON_ENDPOINT');
 const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin',LANG:'C',LC_ALL:'C',TZ:'UTC'},timeout:5000,stdio:['ignore','pipe','pipe']});
 const raw=run('/usr/sbin/lsof',['-nP','-a','-iTCP:'+port,'-sTCP:LISTEN','-Fpun']),pids=[...raw.matchAll(/^p([1-9]\d*)$/gm)].map(m=>Number(m[1])),uids=[...raw.matchAll(/^u([0-9]+)$/gm)].map(m=>Number(m[1]));need(pids.length===1&&uids.length===1&&uids[0]===process.getuid()&&raw.includes('n127.0.0.1:'+port+'\n'),'OLD_DAEMON_LISTENER');
 const pid=pids[0],start=run('/bin/ps',['-p',String(pid),'-o','lstart=']).trim(),command=run('/bin/ps',['-p',String(pid),'-o','command=']).trim(),images=run('/usr/sbin/lsof',['-a','-p',String(pid),'-d','txt','-Fn']);
 need(start&&/^adb -L tcp:(?:localhost|127\.0\.0\.1):[1-9]\d* fork-server server --reply-fd [0-9]+$/.test(command)&&command.includes(':'+port+' fork-server')&&realpathSync(policy.adb_bin)===policy.adb_realpath&&images.split('\n').includes('n'+policy.adb_realpath),'OLD_DAEMON_IDENTITY');
 const executableSha=sha(bytes(policy.adb_realpath));need(executableSha===policy.adb_sha256,'OLD_DAEMON_BINARY');
 return {pid,uid:uids[0],start_identity:start,command,endpoint,executable:policy.adb_realpath,executable_sha256:executableSha,policy_path:join(home,'.config/zenithjoy/adb-service.json'),policy_sha256:sha(bytes(join(home,'.config/zenithjoy/adb-service.json')))};
}
export function validateReviewFacts(f,releaseReceipt){
 const {maintenance:m,original:o,state:s,central:c,execution:e,quarantine:q,local:l,config:cfg}=f,p=m?.payload,id=s?.identity;
 need(uuid.test(m?.id||'')&&m.status==='in_progress'&&typeof m.claimed_by==='string'&&m.claimed_by.trim()&&Number.isFinite(Date.parse(m.claimed_at))&&p?.headed_manual===true,'ACTIVE_MAINTENANCE_TASK');
 need(uuid.test(p.source_task_id||'')&&uuid.test(p.source_run_id||'')&&p.source_task_id!==m.id&&o?.id===p.source_task_id&&o.status==='blocked'&&id?.task_id===o.id&&id.run_id===p.source_run_id&&/^[a-f0-9]{64}$/.test(id.profile_sha256||''),'ORIGINAL_BINDING');
 if(releaseReceipt===undefined){need(c?.device_name===p.serial&&c.locked_by===m.id&&c.expired!==true&&Number.isFinite(Date.parse(c.locked_at))&&Date.parse(c.expires_at)>Date.now()+5000,'CENTRAL_RESERVATION');}
 else{const proof=readReleaseProof(releaseReceipt),current=Object.fromEntries(['device_name','locked_by','locked_at','expires_at','lease_version'].map(k=>[k,c?.[k]]));need(proof.scope.maintenance_task_id===m.id&&proof.scope.serial===p.serial&&canonical(proof.scope.claim)===canonical({claimed_by:m.claimed_by,claimed_at:m.claimed_at})&&canonical(current)===canonical(proof.current)&&c.expired!==true,'CENTRAL_POST_RELEASE');}
 need(e?.execution_stopped===false&&e.external_effect==='unknown'&&s.status==='unknown'&&q?.verified===true&&q.device?.verified===true,'ORIGINAL_UNKNOWN_QUARANTINE');
 need(typeof cfg?.env?.WFR_TAG==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(cfg.env.WFR_TAG)&&cfg.env.SERIAL===p.serial&&cfg.resources?.serial===p.serial&&/^[-A-Za-z0-9_.:]{1,100}$/.test(p.serial||''),'ORIGINAL_DEVICE_SCOPE');
 need(Object.keys(l||{}).sort().join(',')==='acquired_at,owner,pid,standalone_review_required'&&l.owner===cfg.env.WFR_TAG+'\n'&&l.standalone_review_required===l.owner&&/^[1-9][0-9]*\n$/.test(l.pid)&&/^[0-9]+\n$/.test(l.acquired_at),'LOCAL_QUARANTINE');
 // 原路由来自固定原profile；不允许调用者把旧epoch切到另一个server。
 const endpoint=cfg.env.ADB_SERVER_SOCKET,match=endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/);need(match&&Number(match[1])<=65535&&cfg.env.DOUYIN_ADB_PORT===match[1]&&match[1]==='5041','ORIGINAL_ROUTE');
 return {protocol:'device-epoch-fence-review/v1',scope:{maintenance_task_id:m.id,claim:{claimed_by:m.claimed_by,claimed_at:m.claimed_at},original_task_id:o.id,original_run_id:id.run_id,profile_sha256:id.profile_sha256,serial:p.serial,endpoint},central_readback:c,original_execution_stopped:false,remote_quiescence:'unknown',resource_authority:'not_attested'};
}
export async function readBrain(path){
 need(/^\/api\/brain\/(?:tasks\/[a-f0-9-]{36}|runs\/[a-f0-9-]{36}\/(?:definition|reconciliation)|device-locks)$/.test(path),'BRAIN_READ_PATH');const token=process.env.BRAIN_INTERNAL_TOKEN;need(typeof token==='string'&&token&&!/[\r\n]/.test(token),'EXPLICIT_CREDENTIAL_REQUIRED');const r=await fetch('http://127.0.0.1:5221'+path,{headers:{'X-Internal-Token':token},redirect:'error',signal:AbortSignal.timeout(10000)});need(r.status===200&&r.headers.get('content-type')?.startsWith('application/json'),'BRAIN_READ');const text=await r.text();need(Buffer.byteLength(text)<=8*1024*1024,'BRAIN_READ_LIMIT');return JSON.parse(text);
}
export function reviewSource({runtimeRoot=here,repositoryRoot=resolve(here,'../..')}={}){
 need(resolve(runtimeRoot)===runtimeRoot&&realpathSync(runtimeRoot)===runtimeRoot,'REVIEW_SOURCE_ROOT');let manifest=null,git,commit;
 const manifestPath=join(runtimeRoot,'deployment-manifest.json');let present=true;try{lstatSync(manifestPath);}catch(e){if(e.code==='ENOENT')present=false;else throw e;}
 if(present){manifest=JSON.parse(bytes(manifestPath));need(manifest.source_repo==='perfectuser21/zenithjoy-workspace'&&/^[a-f0-9]{40}$/.test(manifest.source_commit||'')&&manifest.target==='mmv'&&Array.isArray(manifest.files),'REVIEW_DEPLOYMENT_SOURCE');commit=manifest.source_commit;}
 else{git=(...args)=>execFileSync('git',['-C',repositoryRoot,...args],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});commit=git('rev-parse','HEAD').trim();}
 const files={},queue=['device-epoch-fence-review.mjs'];
 while(queue.length){const n=queue.shift();if(Object.hasOwn(files,'services/phone-adb-controller/'+n))continue;need(!n.startsWith('../')&&queue.length<512,'REVIEW_IMPORT_SCOPE');const path='services/phone-adb-controller/'+n,b=bytes(join(runtimeRoot,n));
  if(manifest){const rows=manifest.files.filter(r=>r.path===path);need(rows.length===1&&rows[0].deployed_path===n&&rows[0].content_sha256===sha(b),'REVIEW_SOURCE_BYTES');}else need(b.equals(Buffer.from(git('show',commit+':'+path))),'REVIEW_SOURCE_DIRTY');files[path]=sha(b);
  for(const match of b.toString().matchAll(/(?:from\s*|import\s*\(\s*|import\s*|new URL\(\s*)['"](\.[^'"]+)['"]/g)){const dependency=resolve(dirname(join(runtimeRoot,n)),match[1]);need(dependency.startsWith(runtimeRoot+'/'),'REVIEW_IMPORT_SCOPE');queue.push(dependency.slice(runtimeRoot.length+1));}
 }return {commit,files};
}

export async function inspectReview({taskId,stateFile,read=readBrain,home=userInfo().homedir,source=reviewSource,daemon=readOldDaemon,releaseReceipt}={}){
 need(uuid.test(taskId||'')&&typeof stateFile==='string'&&resolve(stateFile)===stateFile&&stateFile.startsWith(join(home,'.local/share')+'/'),'REVIEW_INPUT');
 const raw={},json=p=>{const b=bytes(p);raw[p]=sha(b);return JSON.parse(b);},v=await read('/api/brain/tasks/'+taskId),m=v.task??v,p=m.payload;
 need(uuid.test(p?.source_task_id||'')&&uuid.test(p?.source_run_id||'')&&basename(stateFile)===p.source_run_id+'.json','REVIEW_STATE_PATH');
 const ov=await read('/api/brain/tasks/'+p.source_task_id),original=ov.task??ov,state=json(stateFile),run=stateFile.slice(0,-5),cfg=state.profile?.domain_adapter?.config;
 const execution=json(join(run,'public-execution-preflight.json')),quarantine=json(join(run,'resource-quarantine.json')),frozen=json(join(run,'run-definition.json'));
 validateFrozenProjection({state,frozen});
 for(const [name,hash]of Object.entries(frozen.files||{})){need(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name)&&!name.split('/').some(x=>x==='.'||x==='..'),'FROZEN_SOURCE_PATH');const content=bytes(join(run,name));need(sha(content)===hash,'FROZEN_FILE_DIGEST');raw[join(run,name)]=hash;}
 need(canonical(readFrozen(run))===canonical(frozen),'FROZEN_READBACK');
 const centralValue=await read('/api/brain/device-locks'),rows=centralValue.locks?.filter(x=>x.device_name===p.serial);need(centralValue.success===true&&rows?.length===1,'CENTRAL_INVENTORY');
 const root=join(home,'.local/share/zenithjoy/phone-locks'),lockPath=join(root,p.serial+'.lock'),st=lstatSync(lockPath);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&[0o700,0o755].includes(st.mode&0o777)&&realpathSync(lockPath)===lockPath,'LOCAL_LOCK_PATH');
 const rootStat=lstatSync(root);need(rootStat.isDirectory()&&!rootStat.isSymbolicLink()&&rootStat.uid===process.getuid()&&(rootStat.mode&0o777)===0o700&&realpathSync(root)===root,'LOCAL_LOCK_ROOT');
 const markerPath=join(root,'.migration-complete.json'),migration=json(markerPath);need(migration.schema_version===1&&migration.state==='complete'&&migration.legacy_root===join('/private/tmp/openclaw-phone/locks'),'LOCAL_MIGRATION');
 const legacy=migration.legacy_root;need(realpathSync(legacy)===legacy,'LEGACY_LOCK_ROOT');let legacyExists=false;try{lstatSync(join(legacy,p.serial+'.lock'));legacyExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}need(!legacyExists,'LEGACY_ACTIVE_LOCK');
 const guards=[root,legacy].map(dir=>{const path=join(dir,p.serial+'.guard'),g=lstatSync(path);need(g.isFile()&&!g.isSymbolicLink()&&realpathSync(path)===path&&g.uid===process.getuid()&&(g.mode&0o777)===0o600&&g.nlink===2&&g.size===0,'LOCAL_GUARD');return {path,dev:g.dev,ino:g.ino,nlink:g.nlink};});need(guards[0].dev===guards[1].dev&&guards[0].ino===guards[1].ino,'LOCAL_GUARD_ALIAS');
 const local=Object.fromEntries(readdirSync(lockPath).map(n=>{need(/^[a-z_]+$/.test(n),'LOCAL_LOCK_FILE');const b=bytes(join(lockPath,n));raw[join(lockPath,n)]=sha(b);return [n,b.toString()];}));
 const result=validateReviewFacts({maintenance:m,original,state,central:rows[0],execution,quarantine,local,config:cfg},releaseReceipt);
 const binding=await read('/api/brain/runs/'+p.source_run_id+'/definition'),b=binding.binding;
 need(b?.id===state.identity.run_binding?.run_binding_id&&b.run_id===p.source_run_id&&b.workflow_definition_version_id===state.identity.run_binding.workflow_definition_version_id&&b.release_id===frozen.release?.id,'CENTRAL_ORIGINAL_BINDING');
 const policyPath=join(home,'.config/zenithjoy/adb-service.json'),policy=json(policyPath);need(policy.endpoint===result.scope.endpoint&&policy.transport==='tcp','ORIGINAL_POLICY');
 result.scope={...result.scope,original_evidence_sha256:sha(canonical(raw)),central_binding_sha256:sha(canonical(b)),local_quarantine:{dev:st.dev,ino:st.ino,mode:st.mode&0o777,fields_sha256:sha(canonical(local)),guards},review_source:source(),old_daemon:daemon({home,endpoint:result.scope.endpoint,policy})};
 return {...result,network_approval:m.result?.device_epoch_fence_approval,files:raw,local_quarantine:{path:lockPath,dev:st.dev,ino:st.ino,fields:local},original_binding:b,company:cfg.company,required_next:['original-controller-fixed-source-closure','old-route-continuously-revoked','private-epoch-route-authority','sdk31-reviewed-remote-quiescence','current-maintenance-central-and-local-CAS-readbacks']};
}
export const diagnosticExitCode=result=>Array.isArray(result?.diagnostics)&&result.diagnostics.some(r=>!r.wire_complete||r.exit_code!==0)?2:0;
export function validateDiagnosticQuery(query){need(Object.hasOwn(DIAGNOSTIC_COMMANDS,query)||Object.hasOwn(SUPPLEMENTAL_DIAGNOSTIC_COMMANDS,query),'DIAGNOSTIC_QUERY');return query;}
export async function diagnoseReview({taskId,stateFile,directory,read,home,source,processPid,supplemental=false,query:singleQuery}={}){
 if(singleQuery!==undefined)validateDiagnosticQuery(singleQuery);
 const initial=await inspectReview({taskId,stateFile,read,home,source});need(realpathSync(directory)===resolve(directory)&&readdirSync(directory).length===0,'DIAGNOSTIC_OUTPUT');
 const scope={...initial.scope,...(processPid===undefined?{}:{diagnostic_process_pid:processPid})};
 const readAuthority=async()=>{const current=await inspectReview({taskId,stateFile,read,home,source});need(canonical(current)===canonical(initial),'REVIEW_AUTHORITY_DRIFT');return {scope,lease_until:current.central_readback.expires_at};};
 const queries=singleQuery!==undefined?{[singleQuery]:true}:processPid!==undefined?PROCESS_DIAGNOSTIC_COMMANDS:supplemental?SUPPLEMENTAL_DIAGNOSTIC_COMMANDS:DIAGNOSTIC_COMMANDS;
 const results=[];for(const query of Object.keys(queries)){const out=join(directory,query);mkdirSync(out,{mode:0o700});const result=await runDiagnostic({query,scope,directory:out,readAuthority});results.push(result);if(!result.wire_complete||result.exit_code!==0)break;}
 return {protocol:'device-epoch-fence-review/v1',review:initial,diagnostics:results,original_execution_stopped:false,remote_quiescence:'unknown',resource_authority:'not_attested',reason:'SDK31_RAW_REQUIRES_REVIEWED_PARSER'};
}
function readStartupInstance({instanceId,registrySha256,policySha256}){
 const path=join(here,'config/adb-host-instances.json'),raw=bytes(path);need(sha(raw)===registrySha256,'STARTUP_REGISTRY_DIGEST');const registry=JSON.parse(raw),rows=registry.instances?.filter(r=>r.instance_id===instanceId&&r.kind==='managed');need(registry.schema_version===1&&rows?.length===1,'STARTUP_INSTANCE');const row=rows[0],policyRaw=bytes(row.policy_path),st=lstatSync(row.policy_path);need((st.mode&0o777)===0o600&&sha(policyRaw)===policySha256&&canonical(JSON.parse(policyRaw))===canonical(row.policy),'STARTUP_POLICY_DIGEST');
 need(row.policy.schema_version===2&&row.policy.instance_id===instanceId&&/^tcp:127\.0\.0\.1:[1-9]\d{0,4}$/.test(row.policy.endpoint)&&row.policy.endpoint!=='tcp:127.0.0.1:5041','STARTUP_PRIVATE_ENDPOINT');const partners=registry.instances.filter(r=>row.coexists_with?.includes(r.instance_id)&&r.kind==='external_existing');need(partners.length===1&&partners[0].coexists_with?.includes(instanceId),'STARTUP_COEXISTENCE');const partner=partners[0];return {instance_id:instanceId,policy_path:row.policy_path,endpoint:row.policy.endpoint,registry_sha256:registrySha256,policy_sha256:policySha256,partner:{policy_path:partner.policy_path,policy:partner.policy,actual_policy:JSON.parse(bytes(partner.policy_path))}};
}
function loadStartupReceipt(path){const st=lstatSync(path);need((st.mode&0o777)===0o600,'STARTUP_RECEIPT_MODE');return JSON.parse(bytes(path));}
export async function verifyStartupReceipt(options={}){
 const {receiptPath,instanceId,registrySha256,sourceCommit,policySha256}=options,load=options.load??loadStartupReceipt,inspect=options.inspect??inspectReview,source=options.source??reviewSource,instance=options.instance??readStartupInstance;
 need(typeof receiptPath==='string'&&resolve(receiptPath)===receiptPath&&/^[a-z][a-z0-9-]{2,63}$/.test(instanceId||'')&&/^[a-f0-9]{40}$/.test(sourceCommit||'')&&[registrySha256,policySha256].every(x=>/^[a-f0-9]{64}$/.test(x||'')),'STARTUP_ARGUMENTS');const r=load(receiptPath),now=Date.now();
 need(r.protocol==='device-epoch-fence-startup/v1'&&r.action==='start_private_server'&&r.instance_id===instanceId&&r.registry_sha256===registrySha256&&r.policy_sha256===policySha256&&uuid.test(r.task_id||'')&&Number.isFinite(Date.parse(r.issued_at))&&Date.parse(r.issued_at)<=now&&Date.parse(r.expires_at)>now&&Date.parse(r.expires_at)-Date.parse(r.issued_at)<=120000&&r.review?.original_execution_stopped===false,'STARTUP_RECEIPT');
 const currentSource=source();need(currentSource.commit===sourceCommit&&canonical(currentSource)===canonical(r.source_authority),'STARTUP_SOURCE_DRIFT');const fixed=instance({instanceId,registrySha256,policySha256});need(fixed.endpoint===r.endpoint&&fixed.instance_id===instanceId&&fixed.registry_sha256===registrySha256&&fixed.policy_sha256===policySha256,'STARTUP_INSTANCE_DRIFT');
 const current=await inspect({taskId:r.task_id,stateFile:r.state_file});need(canonical(current)===canonical(r.review),'STARTUP_REVIEW_DRIFT');const approved=current.network_approval;need(approved?.protocol==='device-epoch-fence-approval/v1'&&approved.plan_sha256===r.operation_plan_sha256&&/^[a-f0-9]{64}$/.test(approved.plan_sha256||'')&&canonical(approved.actions)===canonical(FENCE_ACTIONS)&&canonical(approved.approved_scope)===canonical(approvalScopeFor({scope:current.scope,instance:fixed,sourceCommit}))&&typeof approved.approved_by==='string'&&approved.approved_by.trim()&&typeof approved.approval_ref==='string'&&approved.approval_ref.trim()&&Date.parse(approved.approved_at)<=Date.now(),'STARTUP_EXPLICIT_APPROVAL');
 const daemon=options.daemon??(()=>{const home=userInfo().homedir,policy=JSON.parse(bytes(join(home,'.config/zenithjoy/adb-service.json')));return readOldDaemon({home,endpoint:current.scope.endpoint,policy});});const old=daemon();need(canonical(old)===canonical(r.old_daemon),'STARTUP_DAEMON_DRIFT');const partner=fixed.partner;need(partner&&canonical(partner.actual_policy)===canonical(partner.policy)&&old.endpoint===partner.policy.endpoint&&old.executable===partner.policy.adb_realpath&&old.executable_sha256===partner.policy.adb_sha256&&old.policy_path===partner.policy_path,'STARTUP_COEXISTENCE');
 need(Date.parse(r.expires_at)>Date.now(),'STARTUP_RECEIPT_EXPIRED');
 return {protocol:'device-epoch-fence-startup-verification/v1',authorized:true,action:'start_private_server',instance_id:instanceId,endpoint:r.endpoint,source_commit:sourceCommit,registry_sha256:registrySha256,policy_sha256:policySha256};
}
export async function planStartupReceipt({taskId,stateFile,instanceId,directory,inspect=inspectReview,instance=readStartupInstance,registryPath=join(here,'config/adb-host-instances.json')}={}){
 const review=await inspect({taskId,stateFile}),registryRaw=bytes(registryPath),registry=JSON.parse(registryRaw),row=registry.instances?.find(r=>r.instance_id===instanceId&&r.kind==='managed');need(row,'STARTUP_INSTANCE');const registrySha256=sha(registryRaw),policySha256=sha(bytes(row.policy_path)),fixed=instance({instanceId,registrySha256,policySha256}),now=Date.now();
 const approved=review.network_approval;need(approved?.protocol==='device-epoch-fence-approval/v1'&&/^[a-f0-9]{64}$/.test(approved.plan_sha256||'')&&typeof approved.approved_by==='string'&&approved.approved_by.trim()&&typeof approved.approval_ref==='string'&&approved.approval_ref.trim()&&Number.isFinite(Date.parse(approved.approved_at))&&Date.parse(approved.approved_at)<=Date.now()&&canonical(approved.actions)===canonical(FENCE_ACTIONS)&&canonical(approved.approved_scope)===canonical(approvalScopeFor({scope:review.scope,instance:fixed,sourceCommit:review.scope.review_source.commit})),'STARTUP_EXPLICIT_APPROVAL');
 const r={operation_plan_sha256:approved.plan_sha256,protocol:'device-epoch-fence-startup/v1',action:'start_private_server',issued_at:new Date(now).toISOString(),expires_at:new Date(Math.min(now+120000,Date.parse(review.central_readback.expires_at))).toISOString(),task_id:taskId,state_file:stateFile,...fixed,source_authority:review.scope.review_source,review,old_daemon:review.scope.old_daemon};
 need(typeof directory==='string'&&resolve(directory)===directory,'STARTUP_OUTPUT');const fd=openSync(directory,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeSync(fd,JSON.stringify(r)+'\n');fsyncSync(fd);}finally{closeSync(fd);}return r;
}
export async function main(args=process.argv.slice(2)){
 let result;
 if(['fence-plan','fence-materialize','fence-apply'].includes(args[0])){result=await (await import('./device-epoch-fence-controller.mjs')).main(args);}
 else if(args[0]==='verify-epoch'){result=await (await import('./device-epoch-fence-admission.mjs')).main(args);}
 else if(args[0]==='verify-startup'){
  need(args.length===11&&args[1]==='--receipt'&&args[3]==='--instance-id'&&args[5]==='--registry-sha256'&&args[7]==='--source'&&args[9]==='--policy-sha256','STARTUP_USAGE');result=await verifyStartupReceipt({receiptPath:args[2],instanceId:args[4],registrySha256:args[6],sourceCommit:args[8],policySha256:args[10]});
 }else if(args[0]==='diagnose-query'){
  need(args.length===5,'DIAGNOSTIC_QUERY_USAGE');result=await diagnoseReview({taskId:args[1],stateFile:args[2],query:args[3],directory:args[4]});
 }else if(args[0]==='diagnose-runtime'){
  need(args.length===4,'DIAGNOSTIC_RUNTIME_USAGE');result=await diagnoseReview({taskId:args[1],stateFile:args[2],directory:args[3],supplemental:true});
 }else if(args[0]==='diagnose-process'){
  need(args.length===5&&/^[1-9][0-9]{0,9}$/.test(args[3]),'DIAGNOSTIC_PROCESS_USAGE');result=await diagnoseReview({taskId:args[1],stateFile:args[2],processPid:Number(args[3]),directory:args[4]});
 }else if(args[0]==='startup-plan'){
  need(args.length===5,'STARTUP_PLAN_USAGE');result=await planStartupReceipt({taskId:args[1],stateFile:args[2],instanceId:args[3],directory:args[4]});
 }else{
  need(args.length===(args[0]==='diagnose'?4:3)&&['inspect','diagnose'].includes(args[0]),'USAGE_inspect_TASK_STATE_or_diagnose_TASK_STATE_EMPTY_DIRECTORY');const options={taskId:args[1],stateFile:args[2],directory:args[3]};result=await (args[0]==='inspect'?inspectReview(options):diagnoseReview(options));
 }process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=diagnosticExitCode(result);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write((/^[A-Z][A-Z0-9_]+$/.test(e.code||'')?e.code:'DEVICE_EPOCH_FENCE_UNKNOWN')+'\n');process.exitCode=2;});
