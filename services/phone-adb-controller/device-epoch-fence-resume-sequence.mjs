// 独立partial序列；普通apply不能进入，旧disconnect不存在于这个执行接口。
const need=(v,c)=>{if(!v)throw Object.assign(Error('RESUME_'+c),{code:'RESUME_'+c});};
export const RESUME_ACTIONS=Object.freeze({
 adopt_authenticated:Object.freeze(['adopt_private_authenticated_transport','observe_sdk31','release_maintenance_lease','publish_epoch_record','archive_old_quarantine']),
 restart_private_auth:Object.freeze(['stop_private_supervisor_once','start_private_supervisor_once','connect_private_serial_once','observe_sdk31','release_maintenance_lease','publish_epoch_record','archive_old_quarantine'])
});
export async function runResumeSequence({plan,io}){
 need(Object.hasOwn(RESUME_ACTIONS,plan.mode),'MODE');await io.assertApproved(plan);
 return io.withDeviceGuard(async guard=>{
  const admit=async()=>{await guard.assertAlive();await io.assertApproved(plan);await guard.assertAlive();};
  const oldAbsent=async()=>{await admit();need(!(await io.oldInventory()).some(r=>r.serial===plan.scope.serial),'OLD_REAPPEARED');await guard.assertAlive();};
  await guard.prepare();await admit();await io.assertOriginalCheckpoint();await oldAbsent();
  const privateCap=await io.inspectPrivateExact();await admit();
  if(plan.mode==='restart_private_auth'){
   await oldAbsent();await io.stopPrivateOnce(privateCap,guard);await io.verifyPrivateTerminal(privateCap);await oldAbsent();
   await admit();await io.startPrivateOnce(guard);await oldAbsent();need((await io.newInventory()).length===0,'PRIVATE_NOT_EMPTY');
   await admit();const connected=await io.connectNewOnce();need(connected.wire_complete===true,'CONNECT_ACK_UNKNOWN');need(connected.action_confirmed===true,'CONNECT_AUTHENTICATION');await oldAbsent();
  }
  const target=await io.newInventory();need(target.length===1&&target[0].serial===plan.scope.serial&&target[0].state==='device','PRIVATE_NOT_AUTHENTICATED');
  if(plan.mode==='adopt_authenticated')await io.adoptPrivateAuthenticated(privateCap);
  await admit();const observed=await io.observeNoninterference();need(observed?.kind==='old-route-fenced-observed-noninterference/v1'&&observed.original_execution_stopped===false&&observed.android_internal==='not_attested','OBSERVATION');
  await oldAbsent();await admit();const released=await io.releaseCentralOnce();need(released.status==='released'&&released.receipt,'CENTRAL_RELEASE_UNKNOWN');await io.assertAfterRelease(released.receipt);
  await guard.assertAlive();const record=await io.createRecord(observed,released.receipt);await guard.assertAlive();await io.assertAfterRelease(released.receipt);await guard.assertAlive();io.checkOperationTime?.();const archive=await guard.commit(record.sha256),final=await io.verifyFinal(released.receipt,archive,record);
  need(final?.old_route_absent===true&&final.central_free===true&&final.archive_verified===true,'FINAL_READBACK');
  return {protocol:'device-epoch-fence-resume-result/v1',status:'fenced',record,archive,prior_checkpoint_sha256:plan.prior.checkpoint_sha256,original_execution_stopped:false,android_internal:'not_attested',authority_basis:observed.kind};
 });
}
