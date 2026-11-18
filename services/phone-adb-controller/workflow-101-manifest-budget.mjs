import {createHash} from 'node:crypto';
import {workflowRunMaxSeconds} from './runtime-definition.mjs';

// Offline construction only: no registration, execution, or edits to an existing run.
// Activity maxima remain intact; the whole-run maximum includes cleanup.
export function create101BudgetCandidate(template,{identity,startedAtMs,task}={}){
 const fail=()=>{throw Error('101_BUDGET_CANDIDATE_INVALID');},uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 const source=template?.run,old=source?.input?.tasks?.['101'];
 if(source?.contract?.workflow!=='douyin-leadgen-101'||!old||!template?.profile?.files
   ||!identity||Object.keys(identity).sort().join(',')!=='run_id,run_tag,task_id'
   ||!uuid.test(identity.task_id||'')||!uuid.test(identity.run_id||'')||!/^[-A-Za-z0-9_]{1,120}$/.test(identity.run_tag||'')
   ||identity.task_id===source.task_id||identity.run_id===source.run_id||identity.run_tag===old.run_tag
   ||task?.id!==identity.task_id||!Number.isSafeInteger(startedAtMs)||startedAtMs<=0||startedAtMs%1000)fail();
 if(old.task_id!==source.task_id||old.run_id!==source.run_id||old.run_tag!==source.input.run_tag)fail();
 const activities=source.contract.activities;
 if(!Array.isArray(activities)||activities.length!==3||new Set(activities.map(a=>a.key)).size!==3
   ||!['preflight','collect_videos','cleanup'].every(k=>activities.some(a=>a.key===k))
   ||activities.some(a=>!Number.isSafeInteger(a.budget?.max_duration_s)||a.budget.max_duration_s<1))fail();
 const explicit=Object.hasOwn(task.payload?.scope||{},'run_max_seconds'),value=task.payload?.scope?.run_max_seconds;
 if(explicit&&(!Number.isSafeInteger(value)||value<1))fail();
 const seconds=workflowRunMaxSeconds({WF_BRAIN_WORKFLOW:'douyin_video_discovery',...(explicit?{WF_RUN_MAX_SECONDS:String(value)}:{})});
 const cleanup=activities.find(a=>a.key==='cleanup').budget.max_duration_s,totalDeadline=startedAtMs+seconds*1000;
 if(cleanup>=seconds||!Number.isSafeInteger(totalDeadline))fail();
 const manifest=structuredClone(template),context=manifest.run.input;
 context.tasks['101']=structuredClone(identity);context.run_tag=identity.run_tag;
 context.local_owner='wf101'+identity.run_id.replaceAll('-','');context.central_owner=identity.task_id;
 context.run_start_ts=startedAtMs/1000;context.run_max_seconds=seconds;
 context.business_deadline_ms=totalDeadline-cleanup*1000;context.cleanup_deadline_ms=totalDeadline;
 if(context.verification?.native)context.verification.native.cleanup_owner=identity.task_id;
 if(typeof context.verification?.proof_manifest_path==='string')context.verification.proof_manifest_path=context.verification.proof_manifest_path.replace(old.run_id,identity.run_id);
 Object.assign(manifest.run,{task_id:identity.task_id,run_id:identity.run_id,deadline_ms:context.business_deadline_ms,cleanup_deadline_ms:totalDeadline});
 const contextBytes=JSON.stringify(context,null,2)+'\n',identityBytes=JSON.stringify(identity,null,2)+'\n',sha=s=>createHash('sha256').update(s).digest('hex');
 manifest.profile.files['context.json']=sha(contextBytes);
 if(Object.hasOwn(manifest.profile.files,'identity.json'))manifest.profile.files['identity.json']=sha(identityBytes);
 return {status:'not_started',registered:false,manifest,context,contextBytes,identityBytes,task_scope:{...structuredClone(task.payload?.scope||{}),run_max_seconds:seconds},budget:{started_at_ms:startedAtMs,total_seconds:seconds,cleanup_reserve_seconds:cleanup,total_deadline_ms:totalDeadline}};
}
