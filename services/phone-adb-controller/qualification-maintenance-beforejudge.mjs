import {isDeepStrictEqual} from 'node:util';
import {digest} from './runtime-definition.mjs';
import {parseQualificationFailure,SUPPORTED_QUALIFICATION_SOURCE} from './qualification-maintenance-evidence.mjs';
const need=value=>{if(!value)throw Error('MAINTENANCE_BEFOREJUDGE_EVIDENCE_INVALID');};
// 仅交叉检查归档的有限失败分支；调用方仍须从受信观察器核原字节、freeze全文件、
// launcher/ACK/正式Task关联、fresh host/device/MMV effects。此结果绝不授予停止或写PG能力。
export function verifyBeforeJudgeEvidence({scope:s,frozen,split,qualification,native_records,progress,tsv}) {
 need(s?.consumer_source===SUPPORTED_QUALIFICATION_SOURCE&&Array.isArray(s.video_ids)&&s.video_ids.length===1);
 const {snapshot_sha256,...body}=frozen||{};
 need(snapshot_sha256===s.snapshot_sha256&&digest(body)===snapshot_sha256);
 const d=frozen.deployment,r=frozen.run_identity,q=frozen.sampling_input,p=frozen.producer_descriptor;
 need(d?.source_repo==='perfectuser21/zenithjoy-workspace'&&d.source_commit===s.consumer_source&&d.target===s.host);
 need(r?.capability==='douyin_video_processing'&&r.tag===s.run_tag&&r.profile===s.profile&&r.serial===s.serial
  &&r.run_id==='douyin_video_processing-'+s.run_tag);
 need(q?.workflow_key==='douyin_video_processing'&&q.run_tag===s.run_tag&&q.profile===s.profile&&q.serial===s.serial
  &&q.line===s.line_key&&q.source_run===s.producer_run&&q.comment_limit===5&&q.collection_budget_s===480);
 need(p?.schema_version===2&&p.company_id===s.company_id&&p.tenant_id===s.tenant_id&&p.company_config_version===s.config_version
  &&p.policy_id===s.policy_id&&p.run_tag===s.producer_run&&p.profile===s.profile&&p.serial===s.serial&&isDeepStrictEqual(p.video_ids,s.video_ids));
 const slots=['preflight','dedup','qualification','collection','cleanup'];
 need(Array.isArray(frozen.activities)&&isDeepStrictEqual(frozen.activities.map(a=>a.reference?.slot_key),slots)
  &&frozen.activities.every(a=>a.version?.source_commit===s.consumer_source));
 const runId=r.run_id+'__a1';
 need(split?.status==='failed'&&split.source_commit===s.consumer_source&&split.run_id===runId&&split.binding_id===s.binding_id
  &&split.profile===s.profile&&(split.task_id===null||split.task_id===s.original_task_id)&&isDeepStrictEqual(split.sampling_input,q));
 need(Array.isArray(split.results)&&isDeepStrictEqual(split.results.map(x=>x.activity),slots)
  &&isDeepStrictEqual(split.results.map(x=>x.status),['completed','completed','failed','blocked','blocked'])
  &&split.results[2].error==='OLD_EXECUTION_TERMINATION_UNKNOWN');
 need(qualification?.activity==='qualification'&&qualification.status==='failed'&&qualification.attempt===1
  &&qualification.error==='OLD_EXECUTION_TERMINATION_UNKNOWN'&&qualification.execution_stopped===false);
 need(Array.isArray(native_records)&&native_records.length>0&&native_records.every(n=>
  ['preflight','dedup','qualification'].includes(n.activity)&&n.run_id===runId&&n.source_commit===s.consumer_source
  &&n.profile===s.profile&&n.serial===s.serial&&n.owner===s.run_tag));
 const natives=native_records.filter(n=>n.activity==='qualification'),native=natives[0];
 need(natives.length===1&&native.status==='unknown'&&native.execution_stopped===false&&native.wait_code===5&&native.wait_signal===null);
 need(progress?.run===s.run_tag&&progress.source_commit===s.consumer_source&&isDeepStrictEqual(progress.leased_video_ids,s.video_ids)
  &&isDeepStrictEqual(progress.qualified_video_ids,[])&&progress.videos?.length===1
  &&progress.videos[0].video_id===s.video_ids[0]&&progress.videos[0].settled===false&&progress.videos[0].attempts===1);
 const failure=parseQualificationFailure(tsv,{run:s.run_tag,video_id:s.video_ids[0],evidence_root:'/private/tmp/openclaw-phone/evidence/'+s.profile});
 return {status:'beforejudge_evidence_consistent',execution_stopped:false,operation_id:native.operation_id,
  scope_sha256:digest(s),failure,bundle_sha256:digest({frozen,split,qualification,native_records,progress,tsv})};
}
