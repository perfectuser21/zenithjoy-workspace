// 独立 Skill 的源码兼容证明来自 Brain 已完成的审核任务；内联receipt只作固定引用。
import {digest,canonical} from './runtime-definition.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,sha=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/;
const need=v=>{if(!v)throw Object.assign(Error('EPOCH_SOURCE_COMPATIBILITY'),{code:'EPOCH_SOURCE_COMPATIBILITY'});};
const same=(a,b)=>canonical(a)===canonical(b),phone=f=>f.discovery_phone_scope??f.collection_phone_scope;
const pathValid=p=>typeof p==='string'&&p.split('/').every(v=>/^[A-Za-z0-9_.-]+$/.test(v)&&v!=='.'&&v!=='..');
function sourceValid(s){return s&&commit.test(s.commit||'')&&s.files&&typeof s.files==='object'&&!Array.isArray(s.files)&&Object.keys(s.files).length>0&&Object.entries(s.files).every(([p,h])=>pathValid(p)&&sha.test(h||''));}
export function epochSourceCompatibilityReference(frozen){
 const ref=frozen.epoch_source_compatibility;if(ref===undefined)return null;
 need(frozen.standalone_skill?.protocol==='codex-exec-v1'&&frozen.public_domain===undefined&&frozen.execution_mode==='agent'&&frozen.primary_host==='codex-exec-v1');
 need(uuid.test(ref?.review_task_id||'')&&ref.review_task_id!==frozen.standalone_skill.task_id&&sha.test(ref.receipt_sha256||'')&&digest(ref.receipt)===ref.receipt_sha256);
 const r=ref.receipt;
 need(r?.protocol==='epoch-source-compatibility/v1'&&sha.test(r.original_record_sha256||'')&&sourceValid(r.original_runtime_source)&&sourceValid(r.candidate_runtime_source)
  &&sha.test(r.candidate_manifest_sha256||'')&&uuid.test(r.release_id||'')&&uuid.test(r.observation_id||'')&&typeof r.serial==='string'&&r.serial
  &&typeof r.instance_id==='string'&&r.instance_id&&sha.test(r.policy_sha256||'')&&Array.isArray(r.changes)
  &&Array.isArray(r.evidence_refs)&&r.evidence_refs.length>0&&r.evidence_refs.every(v=>typeof v==='string'&&v.trim())&&typeof r.actor==='string'&&r.actor.trim());
 return ref;
}
export function compatibilityReviewProjection(task){
 return task&&{id:task.id,status:task.status,task_type:task.task_type,parent_task_id:task.parent_task_id,payload:task.payload&&Object.fromEntries(['work_kind','reviewer','business_task_id','candidate_source_commit','original_record_sha256','development_task_id'].map(k=>[k,task.payload[k]])),actor:task.result?.actor,audit_evidence:task.result?.audit_evidence,receipt:task.result?.epoch_source_compatibility};
}
export function epochCompatibilityRecordScope(frozen){
 const ref=epochSourceCompatibilityReference(frozen),spec=phone(frozen);
 // 只验证原record的资源与原source，不改历史record；正式授权仍需下方fresh Brain读回。
 return ref?{...spec,source_commit:ref.receipt.original_runtime_source.commit}:spec;
}
export function verifyEpochSourceCompatibility({frozen,record,recordSha256,source,reviewTask,developmentTask}){
 const ref=epochSourceCompatibilityReference(frozen);need(ref);const r=ref.receipt,spec=phone(frozen),p=reviewTask?.payload,audit=reviewTask?.result?.audit_evidence;
 need(reviewTask?.task_type==='research'&&p?.work_kind==='epoch_source_compatibility_review'&&p.reviewer===r.actor
  &&p.business_task_id===frozen.standalone_skill.task_id&&p.candidate_source_commit===source?.commit&&p.original_record_sha256===r.original_record_sha256
  &&uuid.test(p.development_task_id||'')&&reviewTask.parent_task_id===p.development_task_id&&p.development_task_id!==p.business_task_id
  &&developmentTask?.id===p.development_task_id&&developmentTask.task_type==='dev'
  &&typeof frozen.standalone_skill.claimer==='string'&&r.actor!==frozen.standalone_skill.claimer
  &&audit&&typeof audit.path==='string'&&audit.path.trim()&&sha.test(audit.sha256||'')&&audit.verdict==='pass'&&r.evidence_refs.includes(audit.path));
 need(reviewTask?.id===ref.review_task_id&&reviewTask.status==='completed'&&reviewTask.result?.actor===r.actor&&same(reviewTask.result?.epoch_source_compatibility,r));
 need(recordSha256===r.original_record_sha256&&spec?.policy_binding?.epoch_fence?.sha256===recordSha256&&same(record.runtime_source,r.original_runtime_source)
  &&same(source,r.candidate_runtime_source)&&source.commit===frozen.deployment?.source_commit&&spec.source_commit===source.commit
  &&r.release_id===frozen.release?.id&&r.observation_id===frozen.deployment?.observation_id&&r.serial===spec.serial&&r.serial===record.resource?.serial
  &&r.instance_id===spec.policy?.instance_id&&r.instance_id===record.new_route?.instance_id&&r.policy_sha256===spec.policy_binding?.policy_sha256&&r.policy_sha256===record.new_route?.policy_sha256);
 const runtime=Object.fromEntries(Object.entries(frozen.files||{}).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
 need(Object.keys(runtime).length>0&&r.candidate_manifest_sha256===digest(runtime));
 const before=r.original_runtime_source.files,after=source.files,expected=Object.keys({...before,...after}).sort().filter(p=>before[p]!==after[p]).map(path=>({path,before_sha256:before[path]??null,after_sha256:after[path]??null}));
 need(r.changes.every(c=>c&&pathValid(c.path)&&Object.keys(c).sort().join(',')==='after_sha256,before_sha256,path'&&(c.before_sha256===null||sha.test(c.before_sha256||''))&&(c.after_sha256===null||sha.test(c.after_sha256||'')))&&same([...r.changes].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),expected));
 return true;
}
