// Exact-source wiring for the existing 104 JSON-stdio operation boundary.
function replace(text,old,next){if(text.split(old).length!==2)throw Error('104_STATE_LAYOUT');return text.replace(old,next);}
export function wire104State(files){
 let r=files['outreach104/runtime-deps.mjs'];
 r="import {readLeadResult,syncLeadResult} from '../activity-104-state.mjs';\n"+r;
 r=replace(r,"['readback','write_back'].includes(op)","['readback','lead_readback','release','write_back'].includes(op)");
 r=replace(r,'return {authorize,qualify,api,withLock:',"return {authorize,qualify,api,readLead:()=>readLeadResult({pool,context:c,scope:s}),syncLead:(journal,record,native)=>syncLeadResult({pool,context:c,scope:s,journal,record,native}),withLock:");
 files['outreach104/runtime-deps.mjs']=r;
 let a=files['outreach104/order-adapter.mjs'];
 a="import {releaseOwnClaim} from '../activity-104-state.mjs';\n"+a;
 a=replace(a,"['inspect','claim','prepare','readback','write_back']","['inspect','claim','prepare','readback','write_back','release','lead_readback']");
 a=replace(a,"if(op==='inspect'){","if(op==='lead_readback')return {status:'readback',lead_readback:await deps.readLead()};\n   if(op==='release'){const released=await releaseOwnClaim({api:deps.api,row,journal:j,claimFields,artifactDir:artifact_dir,saveJournal:flush,authorize:deps.authorize,identity,stable:r=>!deps.validateStable||deps.validateStable(r)});return output(released.status,released.record||row,{release_readback:released});}\n   if(op==='inspect'){");
 a=replace(a,"if(equalFields(row,{...claimFields,...fields}))return output(outcome,row,{read_only_recovery:true,native});",`async function completeLead(extra={}){try{return output(outcome,row,{...extra,native,lead_readback:await deps.syncLead(j,row,native)});}catch(error){return output('unknown',row,{...extra,native,reason:'LEAD_WRITEBACK_UNCONFIRMED',lead_error_code:/^[A-Z_]+$/.test(error.message)?error.message:'LEAD_READBACK_ERROR'});}}
   if(equalFields(row,{...claimFields,...fields}))return completeLead({read_only_recovery:true});`);
 a=replace(a,"const ok=await putAndRead(fields,'written');return output(ok?outcome:'unknown',row,{native,original_order:j.last_get||null});","const ok=await putAndRead(fields,'written');return ok?completeLead({original_order:j.last_get||null}):output('unknown',row,{native,original_order:j.last_get||null});");
 files['outreach104/order-adapter.mjs']=a;
 for(const [name,old,next]of [
  ['outreach104/profile-input.mjs',"cleanup:['readback']","cleanup:['readback','release','lead_readback']"],
  ['outreach104/tool_extension.py',"'cleanup':{'readback'}","'cleanup':{'readback','release','lead_readback'}"]]){
  let x=replace(files[name],old,next);
  // All phases may inspect this exact Lead; only write_back and cleanup retain their existing writes.
  x=x.replaceAll("'inspect','readback'","'inspect','readback','lead_readback'").replaceAll("'claim','prepare','readback'","'claim','prepare','readback','lead_readback'").replaceAll("'write_back','readback'","'write_back','readback','lead_readback'");
  if(name.endsWith('.py'))x=replace(x,"return json.loads(args[0])=={'op':'readback'}","return json.loads(args[0]) in ({'op':'readback'},{'op':'lead_readback'})");
  files[name]=x;
 }
 files['outreach104/TOOLS104.txt']+='\n原订单工具补齐：cleanup 可调用 outreach {"op":"release"}，仅释放同Task/run已明确未prepared的本人claim；prepared/unknown/已发不得释放。write_back 原操作会同步既有PG Lead并返回lead_readback，PG未证不得称完整完成。各Activity可用 outreach {"op":"lead_readback"} 只读原Lead与outbox来源；返回原字段，不发信、不写库、不输出业务passed。所有输入身份来自冻结context，不接收Agent自拟Lead/订单ID。\n';
 return files;
}
