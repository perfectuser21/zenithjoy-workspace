// 只读消费Brain冻结运行与实际Activity/Step对账；安装观测/Pilot绿不等于业务绿。
import {digest} from './runtime-definition.mjs';
const need=(ok,message)=>{if(!ok)throw Error('业务发布准入: '+message);};
const repo='perfectuser21/zenithjoy-workspace';
const executionTarget=key=>key==='douyin_comment_scoring'||['workflow_report.internal','workflow_commander.internal','douyin_video_publish.android'].includes(key)?'mmv':'xian-m4';
function verifySharedCommander(release,expectedDefinitions,binding,spans){
 const shared=expectedDefinitions.workflows.find(w=>w.payload.key==='workflow_commander.internal');
 need(shared,'缺共享Commander定义');
 need(release.payload.workflows.some(w=>w.id===shared.id&&w.payload_sha256===shared.payload_sha256),'共享Commander冻结版本不符');
 const ids=new Set(shared.payload.activities.map(a=>a.activity_version_id));
 const bindings=expectedDefinitions.activities.filter(a=>ids.has(a.id)).flatMap(a=>a.payload.implementation_bindings||[]).filter(b=>b.status==='verified'&&['code','skill'].includes(b.kind));
 need(bindings.length>0,'缺共享Commander固定实现');
 for(const b of bindings)need(release.payload.components.some(c=>c.kind===b.kind&&c.path===b.path&&c.repo===b.repo&&c.revision===b.revision&&c.digest===b.digest),'候选没有覆盖共享Commander实现');
 need(/^[a-f0-9]{64}$/.test(binding.runtime_snapshot_sha256||''),'缺真实Commander运行字节身份');
 need(Array.isArray(spans)&&spans.length>0&&spans.every(s=>s.run_binding_id===binding.id&&s.evidence?.runtime_snapshot_sha256===binding.runtime_snapshot_sha256),'共享Commander未由同一运行字节的实际span证明');
}
export async function verifyBusinessAdmission({sha,targets,runIds,request}){
 need(/^[a-f0-9]{40}$/.test(sha),'缺固定SHA');
 need(Array.isArray(runIds)&&runIds.length>0&&runIds.length<=32&&new Set(runIds).size===runIds.length&&runIds.every(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)),'必须提供真实候选run ID清单');
 const required=new Map();
 for(const [target,value]of Object.entries(targets))for(const w of value.definitions.workflows){
  // 共享协议由使用它的真实report/publish运行覆盖；它不是可独立派发的业务run。
  if(w.payload.key==='workflow_commander.internal')continue;
  if(executionTarget(w.payload.key)===target)required.set(`${target}:${w.id}`,w);
 }
 need(required.size>0,'没有明确的业务验收范围');
 const covered=new Set(),runs=[];
 for(const runId of runIds){
  const context=await request(`/api/brain/runs/${encodeURIComponent(runId)}/definition`);
  const b=context?.binding;
  need(b?.run_id===runId&&b.release_id&&b.id&&b.observation_id,'运行缺真实冻结身份');
  const release=(await request(`/api/brain/releases/${encodeURIComponent(b.release_id)}`))?.release;
  need(release?.id===b.release_id&&release.environment===`staging:${sha}`&&targets[release.target],'运行不属于候选环境/目标');
  const key=`${release.target}:${b.workflow_definition_version_id}`,expected=required.get(key);
  need(expected&&b.workflow_id===expected.workflow_id&&b.snapshot_sha256===expected.payload_sha256,'运行不覆盖本次固定workflow');
  need(release.payload?.components?.some(c=>c.kind==='repo'&&c.repo===repo&&c.revision===sha)
   &&release.payload.components.every(c=>c.repo===repo&&c.revision===sha),'候选组件版本不符');
  const actual=release.payload.workflows?.find(w=>w.id===expected.id);
  need(actual&&actual.source_repo===repo&&actual.source_commit===sha&&actual.payload_sha256===expected.payload_sha256,'候选冻结版本不符');
  const gate=await request(`/api/brain/releases/${encodeURIComponent(release.id)}/gate`);
  need(gate.release_id===release.id&&gate.deployed===true&&gate.actual_matches===true&&gate.current_observation_id===b.observation_id,'候选安装已漂移或观测不符');
  const rec=await request(`/api/brain/runs/${encodeURIComponent(runId)}/reconciliation`);
  need(rec?.run_id===runId&&rec.run_binding_id===b.id&&rec.release_id===release.id,'业务对账身份不符');
  need(rec.business_outcome==='pass'&&rec.evidence_status==='verified'
   &&['gaps','missing','unexpected'].every(k=>Array.isArray(rec[k])&&rec[k].length===0)
   &&Number.isSafeInteger(rec.expected_count)&&rec.expected_count>0&&Number.isSafeInteger(rec.span_count)&&rec.span_count>=rec.expected_count,'业务验收未通过或证据不完整');
  if(['workflow_report.internal','douyin_video_publish.android'].includes(expected.payload.key)){
   need(rec.links?.task_id&&rec.task_run?.status==='success','Commander尚未完成独立核验');
   const task=await request(`/api/brain/tasks/${encodeURIComponent(rec.links.task_id)}`);
   const control=task?.result?.workflow_control,verification=control?.verification;
   need(task.status==='completed'&&control?.phase==='final'&&verification?.verdict==='PASS'
    &&verification.task_id===task.id&&verification.run_id===runId
    &&verification.definition_sha256===expected.payload_sha256
    &&control.envelope?.definition?.release_id===release.id
    &&control.envelope.definition.runtime_snapshot_sha256===b.runtime_snapshot_sha256
    &&Array.isArray(verification.assertions)&&verification.assertions.length>0&&verification.assertions.every(a=>a.pass===true)
    &&Array.isArray(verification.evidence)&&verification.evidence.length>0,'Commander独立验收不完整或版本不符');
   const run=await request(`/api/brain/runs/${encodeURIComponent(runId)}?include=spans`);
   verifySharedCommander(release,targets[release.target].definitions,b,run?.spans);
  }
  covered.add(key);runs.push({run_id:runId,release_id:release.id,run_binding_id:b.id,workflow_definition_version_id:expected.id,target:release.target,reconciliation_sha256:digest(rec)});
 }
 need([...required.keys()].every(key=>covered.has(key)),'缺少本次发布workflow的真实候选验收');
 return {source_commit:sha,scope:'candidate_business_runs',runs};
}
