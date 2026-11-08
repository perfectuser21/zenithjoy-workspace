// 设备epoch维护只读入口。没有disconnect、start-server、解锁或历史状态写回入口。
import {readFileSync,lstatSync,readdirSync,realpathSync,mkdirSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';
import {userInfo} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runDiagnostic,DIAGNOSTIC_COMMANDS} from './device-epoch-fence-diagnostics.mjs';
const here=dirname(fileURLToPath(import.meta.url)),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
function bytes(path){
 let fd;try{need(realpathSync(path)===resolve(path),'REVIEW_PATH');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);need(s.isFile()&&s.uid===process.getuid()&&!(s.mode&0o022)&&s.nlink===1&&s.size<=32*1024*1024,'REVIEW_FILE');const b=Buffer.alloc(s.size+1);let n=0,k;while(n<b.length&&(k=readSync(fd,b,n,b.length-n,null))>0)n+=k;const e=fstatSync(fd);need(n===s.size&&e.dev===s.dev&&e.ino===s.ino&&e.ctimeMs===s.ctimeMs&&e.mtimeMs===s.mtimeMs,'REVIEW_FILE_DRIFT');return b.subarray(0,n);}finally{if(fd!==undefined)closeSync(fd);}
}
export function validateReviewFacts(f){
 const {maintenance:m,original:o,state:s,central:c,execution:e,quarantine:q,local:l,config:cfg}=f,p=m?.payload,id=s?.identity;
 need(uuid.test(m?.id||'')&&m.status==='in_progress'&&typeof m.claimed_by==='string'&&m.claimed_by.trim()&&Number.isFinite(Date.parse(m.claimed_at))&&p?.headed_manual===true,'ACTIVE_MAINTENANCE_TASK');
 need(uuid.test(p.source_task_id||'')&&uuid.test(p.source_run_id||'')&&p.source_task_id!==m.id&&o?.id===p.source_task_id&&o.status==='blocked'&&id?.task_id===o.id&&id.run_id===p.source_run_id&&/^[a-f0-9]{64}$/.test(id.profile_sha256||''),'ORIGINAL_BINDING');
 need(c?.device_name===p.serial&&c.locked_by===m.id&&c.expired!==true&&Number.isFinite(Date.parse(c.locked_at))&&Date.parse(c.expires_at)>Date.now()+5000,'CENTRAL_RESERVATION');
 need(e?.execution_stopped===false&&e.external_effect==='unknown'&&s.status==='unknown'&&q?.verified===true&&q.device?.verified===true,'ORIGINAL_UNKNOWN_QUARANTINE');
 need(typeof cfg?.env?.WFR_TAG==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(cfg.env.WFR_TAG)&&cfg.env.SERIAL===p.serial&&cfg.resources?.serial===p.serial&&/^[-A-Za-z0-9_.:]{1,100}$/.test(p.serial||''),'ORIGINAL_DEVICE_SCOPE');
 need(Object.keys(l||{}).sort().join(',')==='acquired_at,owner,pid,standalone_review_required'&&l.owner===cfg.env.WFR_TAG+'\n'&&l.standalone_review_required===l.owner&&/^[1-9][0-9]*\n$/.test(l.pid)&&/^[0-9]+\n$/.test(l.acquired_at),'LOCAL_QUARANTINE');
 // 原路由来自固定原profile；不允许调用者把旧epoch切到另一个server。
 const endpoint=cfg.env.ADB_SERVER_SOCKET,match=endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/);need(match&&Number(match[1])<=65535&&cfg.env.DOUYIN_ADB_PORT===match[1]&&match[1]==='5041','ORIGINAL_ROUTE');
 return {protocol:'device-epoch-fence-review/v1',scope:{maintenance_task_id:m.id,claim:{claimed_by:m.claimed_by,claimed_at:m.claimed_at},original_task_id:o.id,original_run_id:id.run_id,profile_sha256:id.profile_sha256,serial:p.serial,endpoint},central_readback:c,original_execution_stopped:false,remote_quiescence:'unknown',resource_authority:'not_attested'};
}
async function readBrain(path){
 need(/^\/api\/brain\/(?:tasks\/[a-f0-9-]{36}|runs\/[a-f0-9-]{36}\/definition|device-locks)$/.test(path),'BRAIN_READ_PATH');const token=process.env.BRAIN_INTERNAL_TOKEN;need(typeof token==='string'&&token&&!/[\r\n]/.test(token),'EXPLICIT_CREDENTIAL_REQUIRED');const r=await fetch('http://127.0.0.1:5221'+path,{headers:{'X-Internal-Token':token},redirect:'error',signal:AbortSignal.timeout(10000)});need(r.status===200&&r.headers.get('content-type')?.startsWith('application/json'),'BRAIN_READ');const text=await r.text();need(Buffer.byteLength(text)<=8*1024*1024,'BRAIN_READ_LIMIT');return JSON.parse(text);
}
export function reviewSource(){
 const repo=resolve(here,'../..'),git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}),commit=git('rev-parse','HEAD').trim(),files={};
 for(const n of ['device-epoch-fence-review.mjs','device-epoch-fence-diagnostics.mjs','adb-shell-v2-protocol.mjs']){const path='services/phone-adb-controller/'+n,b=bytes(join(here,n));need(b.equals(Buffer.from(git('show',commit+':'+path))),'REVIEW_SOURCE_DIRTY');files[path]=sha(b);}return {commit,files};
}
export async function inspectReview({taskId,stateFile,read=readBrain,home=userInfo().homedir,source=reviewSource}={}){
 need(uuid.test(taskId||'')&&typeof stateFile==='string'&&resolve(stateFile)===stateFile&&stateFile.startsWith(join(home,'.local/share')+'/'),'REVIEW_INPUT');
 const raw={},json=p=>{const b=bytes(p);raw[p]=sha(b);return JSON.parse(b);},v=await read('/api/brain/tasks/'+taskId),m=v.task??v,p=m.payload;
 need(uuid.test(p?.source_task_id||'')&&uuid.test(p?.source_run_id||'')&&basename(stateFile)===p.source_run_id+'.json','REVIEW_STATE_PATH');
 const ov=await read('/api/brain/tasks/'+p.source_task_id),original=ov.task??ov,state=json(stateFile),run=stateFile.slice(0,-5),cfg=state.profile?.domain_adapter?.config;
 const execution=json(join(run,'public-execution-preflight.json')),quarantine=json(join(run,'resource-quarantine.json')),frozen=json(join(run,'run-definition.json'));
 need(canonical(frozen)===canonical(cfg?.snapshot),'FROZEN_SNAPSHOT');
 const centralValue=await read('/api/brain/device-locks'),rows=centralValue.locks?.filter(x=>x.device_name===p.serial);need(centralValue.success===true&&rows?.length===1,'CENTRAL_INVENTORY');
 const root=join(home,'.local/share/zenithjoy/phone-locks'),lockPath=join(root,p.serial+'.lock'),st=lstatSync(lockPath);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700&&realpathSync(lockPath)===lockPath,'LOCAL_LOCK_PATH');
 const local=Object.fromEntries(readdirSync(lockPath).map(n=>{need(/^[a-z_]+$/.test(n),'LOCAL_LOCK_FILE');const b=bytes(join(lockPath,n));raw[join(lockPath,n)]=sha(b);return [n,b.toString()];}));
 const result=validateReviewFacts({maintenance:m,original,state,central:rows[0],execution,quarantine,local,config:cfg});
 const binding=await read('/api/brain/runs/'+p.source_run_id+'/definition'),b=binding.binding;
 need(b?.id===state.identity.run_binding?.run_binding_id&&b.run_id===p.source_run_id&&b.workflow_definition_version_id===state.identity.run_binding.workflow_definition_version_id&&b.release_id===frozen.release?.id,'CENTRAL_ORIGINAL_BINDING');
 const policyPath=join(home,'.config/zenithjoy/adb-service.json'),policy=json(policyPath);need(policy.endpoint===result.scope.endpoint&&policy.transport==='tcp','ORIGINAL_POLICY');
 result.scope={...result.scope,original_evidence_sha256:sha(canonical(raw)),central_binding_sha256:sha(canonical(b)),local_quarantine:{dev:st.dev,ino:st.ino,fields_sha256:sha(canonical(local))},review_source:source()};
 return {...result,files:raw,local_quarantine:{path:lockPath,dev:st.dev,ino:st.ino,fields:local},original_binding:b,company:cfg.company,required_next:['original-controller-fixed-source-closure','old-route-continuously-revoked','private-epoch-route-authority','sdk31-reviewed-remote-quiescence','current-maintenance-central-and-local-CAS-readbacks']};
}
export async function diagnoseReview({taskId,stateFile,directory,read,home,source}={}){
 const initial=await inspectReview({taskId,stateFile,read,home,source});need(realpathSync(directory)===resolve(directory)&&readdirSync(directory).length===0,'DIAGNOSTIC_OUTPUT');
 const readAuthority=async()=>{const current=await inspectReview({taskId,stateFile,read,home,source});need(canonical(current)===canonical(initial),'REVIEW_AUTHORITY_DRIFT');return {scope:initial.scope,lease_until:current.central_readback.expires_at};};
 const results=[];for(const query of Object.keys(DIAGNOSTIC_COMMANDS)){const out=join(directory,query);mkdirSync(out,{mode:0o700});const result=await runDiagnostic({query,scope:initial.scope,directory:out,readAuthority});results.push(result);if(!result.wire_complete||result.exit_code!==0)break;}
 return {protocol:'device-epoch-fence-review/v1',review:initial,diagnostics:results,original_execution_stopped:false,remote_quiescence:'unknown',resource_authority:'not_attested',reason:'SDK31_RAW_REQUIRES_REVIEWED_PARSER'};
}
export async function main(args=process.argv.slice(2)){
 need(args.length===(args[0]==='diagnose'?4:3)&&['inspect','diagnose'].includes(args[0]),'USAGE_inspect_TASK_STATE_or_diagnose_TASK_STATE_EMPTY_DIRECTORY');const options={taskId:args[1],stateFile:args[2],directory:args[3]},result=await (args[0]==='inspect'?inspectReview(options):diagnoseReview(options));process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write((/^[A-Z][A-Z0-9_]+$/.test(e.code||'')?e.code:'DEVICE_EPOCH_FENCE_UNKNOWN')+'\n');process.exitCode=2;});
