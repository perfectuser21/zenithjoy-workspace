// 只读历史证据；不重试网络、不更改原pending，也不自行产生恢复授权。
import {join,dirname,resolve} from 'node:path';
import {lstatSync,readdirSync,realpathSync,existsSync} from 'node:fs';
import {bytes,digest,canonical,FENCE_ACTIONS,approvalScopeFor} from './device-epoch-fence-reference.mjs';
import {reviewSource} from './device-epoch-fence-review.mjs';
import {adbPayloadLength} from './adb-shell-v2-protocol.mjs';
import {parseDeviceInventory,parseHostAction} from './device-epoch-fence-transport.mjs';
export const RESUMABLE_PRIOR_SOURCE='48b04e27c58d3244b37000dee8711d329a2ddb3b';
const need=(v,c)=>{if(!v)throw Object.assign(Error('RESUME_'+c),{code:'RESUME_'+c});};
const same=(a,b)=>canonical(a)===canonical(b);
function directory(path){const s=lstatSync(path);need(resolve(path)===path&&realpathSync(path)===path&&s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700,'PRIVATE_DIRECTORY');}
export function readResumeCheckpoint({planPath,applyDirectory,priorRuntimeRoot,task,readSource=reviewSource}={}){
 const files={};
 const raw=path=>{const st=lstatSync(path);need((st.mode&0o777)===0o600,'FILE_MODE');const b=bytes(path);files[path]=digest(b);return b;};
 const json=path=>{try{return JSON.parse(raw(path));}catch(e){need(false,'FILE_JSON');}};
 directory(applyDirectory);directory(dirname(planPath));
 const plan=json(planPath),{plan_sha256:planSha,...planBody}=plan;
 need(plan.protocol==='device-epoch-fence-plan/v1'&&planSha===digest(planBody)&&plan.original_execution_stopped===false,'PRIOR_PLAN');
 need(plan.scope?.review_source?.commit===RESUMABLE_PRIOR_SOURCE&&same(readSource({runtimeRoot:priorRuntimeRoot}),plan.scope.review_source),'PRIOR_SOURCE');
 const approval=task?.result?.device_epoch_fence_approval;
 need(task.id===plan.task_id&&approval?.protocol==='device-epoch-fence-approval/v1'&&approval.plan_sha256===planSha&&same(approval.actions,FENCE_ACTIONS)&&same(approval.approved_scope,plan.approval_scope)&&same(plan.approval_scope,approvalScopeFor({scope:plan.scope,instance:plan.new_instance,sourceCommit:RESUMABLE_PRIOR_SOURCE}))&&typeof approval.approved_by==='string'&&approval.approved_by.trim()&&typeof approval.approval_ref==='string'&&approval.approval_ref.trim(),'PRIOR_APPROVAL');
 const serial=plan.scope.serial,oldEndpoint=plan.scope.endpoint,newEndpoint=plan.new_instance.policy.endpoint;
 need(oldEndpoint==='tcp:127.0.0.1:5041'&&newEndpoint==='tcp:127.0.0.1:5042'&&typeof serial==='string','PRIOR_ROUTE');
 const unknown=json(join(applyDirectory,'unknown.json'));
 need(unknown.protocol==='device-epoch-fence-result/v1'&&unknown.status==='unknown'&&unknown.error_code==='DIAGNOSTIC_RECEIPT'&&unknown.original_execution_stopped===false&&unknown.android_internal==='not_attested'&&unknown.retry_allowed===false&&unknown.central===null,'PRIOR_UNKNOWN');
 for(const name of ['result.json','central-release.json','record-issued.json','noninterference.json','helper-committed.json'])need(!existsSync(join(applyDirectory,name)),'PRIOR_IRREVERSIBLE_PHASE');
 function host(name,operation,endpoint){
  const path=join(applyDirectory,name);directory(path);
  const intent=json(join(path,'intent.json')),result=json(join(path,'result.json')),b=raw(join(path,'host-response.raw'));
  need(b.length>=8&&b.subarray(0,4).toString()==='OKAY'&&b.length===8+adbPayloadLength(b.subarray(4,8),65536),'HOST_RAW');
  const response=b.subarray(8).toString('utf8'),scope={endpoint,serial};
  need(Buffer.from(response).equals(b.subarray(8))&&intent.protocol==='device-epoch-fence-host-operation/v1'&&intent.operation===operation&&intent.service===(operation==='inventory'?'host:devices-l':'host:'+operation+':'+serial)&&same(intent.scope,scope)&&result.protocol===intent.protocol&&result.operation===operation&&same(result.scope,scope)&&result.wire_complete===true&&result.error_code===null&&result.peer_eof===true&&result.socket_closed===true&&result.pending===0&&result.raw_sha256===digest(b)&&result.response===response&&result.original_execution_stopped===false&&result.retry_allowed===false,'HOST_PROOF');
  const at=Date.parse(intent.at);need(Number.isFinite(at)&&Date.parse(approval.approved_at)<=at&&at<Date.parse(plan.central.expires_at),'PRIOR_ACTION_AUTHORIZATION');
  return response;
 }
 const before=parseDeviceInventory(host('0000-host-inventory','inventory',oldEndpoint));need(before.length===1&&before[0].serial===serial&&before[0].state==='device','PRIOR_OLD_TARGET');
 need(parseHostAction('disconnect',serial,host('0001-host-disconnect','disconnect',oldEndpoint)).action_confirmed,'PRIOR_DISCONNECT');
 need(!parseDeviceInventory(host('0002-host-inventory','inventory',oldEndpoint)).length&&!parseDeviceInventory(host('0003-host-inventory','inventory',newEndpoint)).length,'PRIOR_ROUTE_ABSENCE');
 need(parseHostAction('connect',serial,host('0004-host-connect','connect',newEndpoint)).action_error_code==='HOST_AUTHENTICATION_FAILED','PRIOR_AUTHENTICATION');
 const sdkPath=join(applyDirectory,'0005-diagnostic-sdk');directory(sdkPath);const diagnostic=json(join(sdkPath,'diagnostic.json')),sdkRaw=raw(join(sdkPath,'socket-0.raw'));json(join(sdkPath,'intent.json'));
 need(diagnostic.protocol==='device-epoch-fence-diagnostic/v1'&&diagnostic.query==='sdk'&&diagnostic.scope?.serial===serial&&diagnostic.scope.endpoint===newEndpoint&&diagnostic.scope.maintenance_task_id===plan.task_id&&diagnostic.wire_complete===false&&diagnostic.exit_code===null&&diagnostic.error_code==='DIAGNOSTIC_ADB_FAIL'&&diagnostic.pending===0&&diagnostic.open_sockets===0&&diagnostic.original_execution_stopped===false&&same(diagnostic.files,{'socket-0.raw':digest(sdkRaw)})&&sdkRaw.subarray(0,4).toString()==='FAIL'&&sdkRaw.length===8+adbPayloadLength(sdkRaw.subarray(4,8),65536)&&sdkRaw.subarray(8).toString().startsWith('device unauthorized.'),'PRIOR_SDK_TRANSPORT');
 const locked=json(join(applyDirectory,'helper-locked.json')),prepared=json(join(applyDirectory,'helper-prepared.json')),closed=json(join(applyDirectory,'helper-close.json'));
 need(locked.event==='locked'&&prepared.event==='prepared'&&closed.code===2&&closed.signal===null&&closed.error_code==='EPOCH_LOCK_PROTOCOL'&&closed.original_execution_stopped===false,'PRIOR_HELPER');
 const snapshot=locked.snapshot,quarantine=plan.review.local_quarantine;
 need(snapshot.lock.dev===quarantine.dev&&snapshot.lock.ino===quarantine.ino&&same(snapshot.fields,quarantine.fields),'PRIOR_SNAPSHOT');
 const root=dirname(quarantine.path),pendingPath=join(root,'.device-epoch-fence-'+plan.task_id+'-'+planSha+'.pending.json');
 directory(root);const pendingRaw=raw(pendingPath),pending=JSON.parse(pendingRaw);
 need(same(pending,{protocol:'device-epoch-fence-file-transaction/v1',task_id:plan.task_id,plan_sha256:planSha,snapshot,original_execution_stopped:false,phase:'prepared'}),'PRIOR_PENDING');
 const prefix=pendingPath.slice(0,-'.pending.json'.length);for(const suffix of ['.completed.json','.superseded'])need(!existsSync(prefix+suffix),'PRIOR_ALREADY_COMMITTED');
 // 失败后只读host inventory可以留在同目录；不接纳任何额外业务动作。
 for(const name of readdirSync(applyDirectory).filter(n=>/^\d{4}-/.test(n)&&Number(n.slice(0,4))>=6))need(/^\d{4}-host-inventory$/.test(name)&&!parseDeviceInventory(host(name,'inventory',oldEndpoint)).some(r=>r.serial===serial),'PRIOR_POST_FAILURE_ACTION');
 const body={protocol:'device-epoch-fence-resume-checkpoint/v1',prior_source:plan.scope.review_source,prior_plan_sha256:planSha,prior_pending_sha256:digest(pendingRaw),prior_plan_path:planPath,prior_apply_directory:applyDirectory,prior_runtime_root:priorRuntimeRoot,prior_pending_path:pendingPath,task_id:plan.task_id,serial,old_endpoint:oldEndpoint,new_endpoint:newEndpoint,old_disconnect_confirmed:true,sdk_transport_rejected:true,original_execution_stopped:false,retry_allowed:false,snapshot,original_approval:approval,files};
 return {...body,checkpoint_sha256:digest(body)};
}
