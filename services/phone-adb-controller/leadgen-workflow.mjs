import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runWorkflow} from './activity-commander.mjs';
import {createHandlers} from './leadgen-handlers.mjs';
export {runWorkflow} from './activity-commander.mjs';

export async function invokeNativeActivity(execute,state){
  try{
    const result=await execute();
    if(state.nativeStopUnproven&&['partial','failed'].includes(result?.status)){
      state.executionUnknown=true;
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
import {readFrozen,assertCommentSampling} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {createRpc,execInput} from './leadgen-client.mjs';
import {judgeSteps} from './step-judge.mjs';

export function activityExecutionDeadline({activity,env,previous,now=Date.now()}){
  const budget=Number(activity.budget?.max_duration_s||120);
  const requested=activity.key==='collect_videos'?Number(env.LEADGEN_DISCOVERY_MAX_SECONDS||budget):budget;
  const start=Number(env.WF_RUN_START_TS),whole=Number(env.WF_RUN_MAX_SECONDS);
  if(!Number.isSafeInteger(budget)||budget<1||!Number.isSafeInteger(requested)||requested<1||requested>budget||!Number.isSafeInteger(start)||start<=0||!Number.isSafeInteger(whole)||whole<1)throw Error('请求预算超过Activity合同或全局预算非法');
  if(previous!==undefined&&!Number.isSafeInteger(previous))throw Error('原Activity截止非法');
  return Math.min(previous??now+requested*1000,(start+whole)*1000);
}

async function main(){
  const env=process.env,dir=env.WFR_RUN_DIR;
  const frozen=readFrozen(dir);assertCommentSampling(frozen,env);const binding=readBinding(dir,env.WFR_ATTEMPT,frozen);
  if(binding.run_id!==`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`)throw Error('运行绑定身份不符');
  const root=resolve(dir,'runtime');
  env.DOUYIN_PHONE_ADB=join(root,'douyin-phone-adb');
  if(resolve(env.WF_HOME)!==root||resolve(fileURLToPath(import.meta.url))!==join(root,'leadgen-workflow.mjs'))throw Error('执行器必须来自本批冻结字节');
  if(frozen.runtime_transport){env.LEADGEN_MMV_HOSTNAME=frozen.runtime_transport.ssh_hostname;env.LEADGEN_MMV_HOSTKEY_ALIAS=frozen.runtime_transport.ssh_hostkey_alias;}
  const rpc=createRpc({frozen,local:env.LEADGEN_LOCAL_RPC==='1'});
  const context={sampling_input:frozen.sampling_input||null,run_id:binding.run_id,binding_id:binding.id,task_id:binding.task_id??null,workflow_key:env.WF_BRAIN_WORKFLOW,profile:env.P,source_commit:frozen.deployment.source_commit};
  writeFileSync(join(dir,'activity.log'),'');
  const records=[];const record=async r=>{
    r={...r,observed_at:new Date().toISOString()};
    records.push(r);appendFileSync(join(dir,'activity-events.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});
    if(['execution','verification'].includes(r.phase)){
      const ledgerStatus=r.evidence.status==='failed'?'failed':[r.evidence.status,r.evidence.result?.status].some(status=>['partial','paused','skipped'].includes(status))?'blocked':r.evidence.status;
      const updated=await execInput(process.execPath,[join(root,'ledger.mjs'),'set','--run-dir',dir,
        '--stage',r.activity,'--status',ledgerStatus,'--n','1','--word','']);
      if(updated.code!==0)throw Error('实际活动账本更新失败');
    }
  };
  const activities=frozen.activities.map(a=>({...a.version.payload.contract,key:a.reference.slot_key}));
  const verify=async(activity,result)=>{
    const receipts=records.filter(r=>r.activity===activity.key&&['before','after'].includes(r.phase));
    const metrics={...(result.result?.counts||{}),...result.result,commander_verified:Number(receipts.length>=2&&receipts.every(r=>r.commander_status==='available'))};
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
    const verified=probes.length>0&&probes.every(p=>p.pass===true)&&local.every(r=>r.steps.length===expected.length&&r.steps.every(s=>s.pass===true));
    return {verified,metrics,probes,step_dod:local};
  };
  const handlers=createHandlers({root,env,rpc,sourceCommit:frozen.deployment.source_commit,taskId:binding.task_id});
  const activityDeadlines=new Map();
  const execution=Object.fromEntries(activities.map(activity=>[activity.key,async()=>{
    const deadline=activityExecutionDeadline({activity,env,previous:activityDeadlines.get(activity.key)});
    activityDeadlines.set(activity.key,deadline);handlers.state.budgetDeadline=deadline;
    handlers.state.currentActivity=activity.key;
    if(handlers.state.executionUnknown){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;throw e;}
    if(deadline<=Date.now())throw Error('EXECUTION_DEADLINE: 原Activity或整轮预算已尽');
    if(activity.key!=='cleanup'&&env.WF_STOP_FILE&&existsSync(env.WF_STOP_FILE))return {status:'partial',reason:'已收到停止请求'};
    const result=await invokeNativeActivity(()=>handlers[activity.key](),handlers.state);
    if(handlers.state.executionUnknown){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;throw e;}
    return result;
  }]));
  const recover=createActivityRecovery({runDir:dir,frozen,binding,env,handlers,rpc,verify});
  const result=await runWorkflow({activities,context,handlers:execution,recover,quarantine:handlers.quarantineResources,
    commander:async receipt=>{
      if(receipt.phase==='before'){
        const mark=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'mark-start',receipt.activity,'1']);
        if(mark.code!==0)throw Error('活动起始证据未登记');
      }
      return (await rpc({kind:'commander',receipt},{timeoutMs:75000})).decision;
    },record,verify});
  for(const item of result.results){
    const file=join(dir,`activity-${item.activity}.json`);
    writeFileSync(file,JSON.stringify({...item,observed_at:new Date().toISOString(),metrics:item.verification?.metrics||item.result||{},commander:records.filter(r=>r.activity===item.activity)},null,2));
    // 中央证据失败使验收不通过，不能只凭本地日志宣称已完成。
    const sent=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'span',item.activity,
      item.status==='completed'?'completed':['blocked','skipped'].includes(item.status)||item.result?.status==='paused'?'blocked':'failed','1',file]);
    if(sent.code!==0)result.status='failed';
  }
  const delivery=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'flush']);
  result.evidence_status=delivery.code===0&&/WFR_EVIDENCE_STATUS=sent/.test(delivery.stdout)?'sent':'pending_or_blocked';
  if(result.evidence_status!=='sent')result.status='failed';
  writeFileSync(join(dir,'split-result.json'),JSON.stringify({...context,...result},null,2));
  process.stdout.write(JSON.stringify({...context,...result})+'\n');
  if(result.status!=='completed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  process.stderr.write('新流程执行失败，请读取本批固定定义与活动证据\n');process.exitCode=1;
});
