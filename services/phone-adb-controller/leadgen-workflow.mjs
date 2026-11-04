import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runWorkflow} from './activity-commander.mjs';
import {createHandlers} from './leadgen-handlers.mjs';
export {runWorkflow} from './activity-commander.mjs';
import {collectionEvidenceProof,collectionCleanupEvidence} from './collection-phone-scope.mjs';
import {discoveryCleanupEvidence} from './discovery-phone-scope.mjs';

export async function invokeNativeActivity(execute,state){
  try{
    const result=await execute();
    if(state.nativeStopUnproven&&(state.currentActivity==='collect_videos'||['partial','failed'].includes(result?.status))){
      const scope={run_id:state.run_id,task_id:state.task_id,source_commit:state.source_commit,activity:state.currentActivity};
      const proof=collectionEvidenceProof(result,scope)||collectionCleanupEvidence(result,scope)||discoveryCleanupEvidence(result,scope);
      if(!proof)state.executionUnknown=true;
      return {...result,execution_stopped:false};
    }
    return result;
  }catch(error){
    if(state.nativeStopUnproven){state.executionUnknown=true;error.executionStopped=false;error.externalEffect='unknown';}
    throw error;
  }
}
export {parseCollection,createHandlers} from './leadgen-handlers.mjs';
import {createActivityRecovery} from './activity-skill-recovery.mjs';
import {readFrozen,assertCommentSampling,assertOutreachScope} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {createRpc,execInput} from './leadgen-client.mjs';
import {judgeSteps,workflowReadbackPassed} from './step-judge.mjs';
import {verifyDiscoveryFilterEvidence} from './leadgen-discovery.mjs';
import discoveryMetrics from './discovery-metrics.js';
import lineRoutes from './line-routes.js';
import {verifyCleanupReadback} from './discovery-cleanup-readback.mjs';
import {summarizeCommanderEvidence} from './commander-model-receipt.mjs';

export function readCommanderSkill(frozen,runDir){
 const path='runtime/skills/runner-commander/SKILL.md',bytes=readFileSync(join(runDir,path));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 if(frozen.files?.[path]!==sha256)throw Error('COMMANDER_SKILL_BYTES_MISMATCH');
 const content=bytes.toString('utf8'),front=content.match(/^---\n([\s\S]*?)\n---/),name=front?.[1].match(/^name:\s*(\S+)$/m)?.[1],version=front?.[1].match(/^  version:\s*(\S+)$/m)?.[1];
 if(name!=='runner-commander'||!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('COMMANDER_SKILL_VERSION_INVALID');
 return {name,version,sha256,content};
}

export function activityExecutionDeadline({activity,env,previous,now=Date.now(),cleanupReserveMs=0}){
  const budget=Number(activity.budget?.max_duration_s||120);
  const requested=activity.key==='collect_videos'?Number(env.LEADGEN_DISCOVERY_MAX_SECONDS||budget):budget;
  const start=Number(env.WF_RUN_START_TS),whole=Number(env.WF_RUN_MAX_SECONDS);
  if(!Number.isSafeInteger(budget)||budget<1||!Number.isSafeInteger(requested)||requested<1||requested>budget||!Number.isSafeInteger(start)||start<=0||!Number.isSafeInteger(whole)||whole<1)throw Error('请求预算超过Activity合同或全局预算非法');
  if(previous!==undefined&&!Number.isSafeInteger(previous))throw Error('原Activity截止非法');
  if(!Number.isSafeInteger(cleanupReserveMs)||cleanupReserveMs<0||cleanupReserveMs>=whole*1000)throw Error('原全局清场预留非法');
  return Math.min(previous??now+requested*1000,(start+whole)*1000-(activity.key==='collect_videos'?cleanupReserveMs:0));
}

async function main(){
  const env=process.env,dir=env.WFR_RUN_DIR;
  const frozen=readFrozen(dir);assertCommentSampling(frozen,env);assertOutreachScope(frozen,env);const binding=readBinding(dir,env.WFR_ATTEMPT,frozen);
  if(binding.run_id!==`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`)throw Error('运行绑定身份不符');
  const centralWorkflow=['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW);
  const taskIds=(centralWorkflow?[env.WF_BRAIN_TASK_ID,env.BRAIN_TASK_ID,env.WFR_BRAIN_TASK_ID,binding.task_id]:[binding.task_id]).filter(Boolean);
  if(new Set(taskIds).size>1)throw Error('CENTRAL_LOCK_TASK_CONFLICT');
  const taskId=taskIds[0]||null;
  const root=resolve(dir,'runtime');
  env.DOUYIN_PHONE_ADB=join(root,'douyin-phone-adb');
  if(resolve(env.WF_HOME)!==root||resolve(fileURLToPath(import.meta.url))!==join(root,'leadgen-workflow.mjs'))throw Error('执行器必须来自本批冻结字节');
  if(frozen.runtime_transport){env.LEADGEN_MMV_HOSTNAME=frozen.runtime_transport.ssh_hostname;env.LEADGEN_MMV_HOSTKEY_ALIAS=frozen.runtime_transport.ssh_hostkey_alias;}
  const rpc=createRpc({frozen,local:env.LEADGEN_LOCAL_RPC==='1',runContext:{run:env.WFR_TAG,run_id:binding.run_id,profile:env.P,line:env.LEADGEN_LINE}});
  const workflowContract=frozen.workflow_version?.payload?.contract||{};
  const context={brief:{purpose:workflowContract.name||env.WF_BRAIN_WORKFLOW,done_criteria:{checks:workflowContract.checks,outputs:workflowContract.outputs},boundaries:{resources:workflowContract.resources,recovery:workflowContract.recovery}},rules:workflowContract.rules||[],require_routing:true,workflow_routes:frozen.workflow_version?.payload?.contract?.on_status,always_run:frozen.workflow_version?.payload?.contract?.always_run,sampling_input:frozen.sampling_input||null,run_id:binding.run_id,binding_id:binding.id,task_id:taskId,workflow_key:env.WF_BRAIN_WORKFLOW,profile:env.P,source_commit:frozen.deployment.source_commit};
  try{context.commander_skill=readCommanderSkill(frozen,dir);}catch{context.commander_skill_unavailable=true;}
  writeFileSync(join(dir,'activity.log'),'');
  const records=[];const record=async r=>{
    r={...r,observed_at:new Date().toISOString()};
    records.push(r);appendFileSync(join(dir,'activity-events.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});
    if(r.phase==='start'){
      const mark=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'mark-start',r.activity,'1']);
      if(mark.code!==0)throw Error('活动起始证据未登记');
    }
    if(['execution','verification'].includes(r.phase)){
      const ledgerStatus=r.evidence.status==='failed'?'failed':[r.evidence.status,r.evidence.result?.status].some(status=>['partial','paused','skipped','needs_review'].includes(status))?'blocked':r.evidence.status;
      const updated=await execInput(process.execPath,[join(root,'ledger.mjs'),'set','--run-dir',dir,
        '--stage',r.activity,'--status',ledgerStatus,'--n','1','--word','']);
      if(updated.code!==0)throw Error('实际活动账本更新失败');
    }
  };
  const activities=frozen.activities.map(a=>({...a.version.payload.contract,key:a.reference.slot_key}));
  const verify=async(activity,result)=>{
    const receipts=records.filter(r=>r.activity===activity.key&&r.phase==='commander_exchange');
    const metrics={...(result.result?.counts||{}),...result.result,commander_verified:Number(receipts.length>0&&receipts.every(r=>r.commander_status==='available'))};
    if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'&&activity.key==='cleanup'){
      const valid=result.result?.cleanup_readback_verified===1&&verifyCleanupReadback({runDir:dir,digest:result.result.cleanup_readback_digest,
        scope:{run:env.WFR_TAG,run_id:binding.run_id,source_commit:frozen.deployment.source_commit,profile:env.P,serial:env.SERIAL}});
      metrics.close_app_attempts=metrics.safe_desktop_visible=Number(valid);
    }
    if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'&&activity.key==='collect_videos'){
      metrics.filters_verified=Number(verifyDiscoveryFilterEvidence({runDir:dir,runId:binding.run_id,run:env.WFR_TAG,profile:env.P,sourceCommit:frozen.deployment.source_commit,
        requested:{sort:env.LEADGEN_SORT||'latest',time_layer:env.LEADGEN_TIME_LAYER||'six_months',location:env.LEADGEN_LOCATION||'same_city'},invocations:result.result?.filter_invocations}));
      metrics.discovery_metrics_verified=Number(await discoveryMetrics.verifyArchivedObservations({videos:result.result?.videos,runDir:dir,
        scope:{run:env.WFR_TAG,run_id:binding.run_id,profile:env.P,source_commit:frozen.deployment.source_commit,line_key:lineRoutes.routeOf(env.LEADGEN_LINE).key},
        readback:async video=>(await rpc({kind:'queue',request:{op:'discover_readback',run:env.WFR_TAG,line:env.LEADGEN_LINE,video}},{timeoutMs:60000})).result}));
    }
    const response=await rpc({kind:'verify',workflow:env.WF_BRAIN_WORKFLOW,stage:activity.key,run:env.WFR_TAG,line:env.LEADGEN_LINE,metrics},{timeoutMs:100000});
    const spec=JSON.parse(readFileSync(join(dir,'step-dod.json'),'utf8'));
    // 多源取证分别按真实source索引检查，不能拿一个来源的截图代替另一个。
    const phoneEvidence=env.LEADGEN_EVIDENCE_DIR||join('/private/tmp/openclaw-phone/evidence',env.P);
    const atSteps=spec.steps.filter(s=>(s.at||s.activity)===activity.key);
    const steps=atSteps.flatMap(step=>judgeSteps({spec:{...spec,steps:[step]},stage:activity.key,remote:response.result.steps,
      ctx:{metrics,tag:env.WFR_TAG,n:1,word:'',evidenceDir:/identity|readback/.test(step.readback?.glob||'')?dir:phoneEvidence,
        logFile:join(dir,'activity.log'),tsvFile:join(dir,'comments.tsv'),runDir:dir}}).steps);
    const local=[{steps}];
    const probes=response.result.probes||[];
    const expected=spec.steps.filter(s=>(s.at||s.activity)===activity.key);
    const verified=workflowReadbackPassed({probes,steps,expected});
    return {verified,metrics,probes,step_dod:local};
  };
  const handlers=createHandlers({root,env,rpc,sourceCommit:frozen.deployment.source_commit,taskId,outreachScope:frozen.outreach_scope||null});
  const activityDeadlines=new Map();
  const execution=Object.fromEntries(activities.map(activity=>[activity.key,async options=>{
    const cleanupReserveMs=env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'?Number(activities.find(a=>a.key==='cleanup')?.budget?.max_duration_s||120)*1000:0;
    const deadline=activityExecutionDeadline({activity,env,previous:activityDeadlines.get(activity.key),cleanupReserveMs});
    activityDeadlines.set(activity.key,deadline);handlers.state.budgetDeadline=deadline;
    handlers.state.currentActivity=activity.key;
    if(handlers.state.executionUnknown){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;throw e;}
    if(deadline<=Date.now())throw Error('EXECUTION_DEADLINE: 原Activity或整轮预算已尽');
    if(activity.key!=='cleanup'&&env.WF_STOP_FILE&&existsSync(env.WF_STOP_FILE))return {status:'partial',reason:'已收到停止请求'};
    const result=await invokeNativeActivity(()=>handlers[activity.key](options),handlers.state);
    if(handlers.state.executionUnknown){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;e.activityResult=result;throw e;}
    return result;
  }]));
  const recover=createActivityRecovery({runDir:dir,frozen,binding,env,handlers,rpc,verify});
  const result=await runWorkflow({activities,context,handlers:execution,recover,quarantine:handlers.quarantineResources,
    commander:async receipt=>{if(context.commander_skill_unavailable)throw Error('COMMANDER_SKILL_SOURCE_UNAVAILABLE');return (await rpc({kind:'commander',receipt},{timeoutMs:75000})).decision;},record,verify,terminationUnverified:()=>handlers.state.nativeStopUnproven===true});
  for(const item of result.results){
    const file=join(dir,`activity-${item.activity}.json`);
    writeFileSync(file,JSON.stringify({...item,observed_at:new Date().toISOString(),metrics:item.verification?.metrics||item.result||{},commander:records.filter(r=>r.activity===item.activity)},null,2));
    // 中央证据失败使验收不通过，不能只凭本地日志宣称已完成。
    const sent=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'span',item.activity,
      item.status==='completed'?'completed':['blocked','skipped','needs_review'].includes(item.status)||item.result?.status==='paused'?'blocked':'failed','1',file]);
    if(sent.code!==0)result.status='failed';
  }
  const delivery=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'flush']);
  result.evidence_status=delivery.code===0&&/WFR_EVIDENCE_STATUS=sent/.test(delivery.stdout)?'sent':'pending_or_blocked';
  if(result.evidence_status!=='sent')result.status='failed';
  if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery')result.model_call_evidence=summarizeCommanderEvidence(records,context);
  writeFileSync(join(dir,'split-result.json'),JSON.stringify({...context,...result},null,2));
  process.stdout.write(JSON.stringify({...context,...result})+'\n');
  if(result.status!=='completed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  process.stderr.write('新流程执行失败，请读取本批固定定义与活动证据\n');process.exitCode=1;
});
