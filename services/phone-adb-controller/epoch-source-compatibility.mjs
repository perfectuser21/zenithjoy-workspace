// 源码兼容证明来自 Brain 已完成的审核任务；内联 receipt 只作固定引用。
import {digest,canonical} from './runtime-definition.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,sha=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/;
const need=v=>{if(!v)throw Object.assign(Error('EPOCH_SOURCE_COMPATIBILITY'),{code:'EPOCH_SOURCE_COMPATIBILITY'});};
const same=(a,b)=>canonical(a)===canonical(b),phone=f=>f.discovery_phone_scope??f.collection_phone_scope;
const cloudProtocol='cloud-101-epoch-source-compatibility/v1';
export const isCloudEpochSourceCompatibility=ref=>ref?.receipt?.protocol===cloudProtocol;

function cloudDiscoveryRun(frozen){
 const spec=frozen.discovery_phone_scope,d=frozen.deployment,p=frozen.public_domain;
 need(!frozen.standalone_skill&&frozen.execution_mode==='code'&&frozen.primary_host===undefined
  &&!frozen.collection_phone_scope&&frozen.workflow_version?.payload?.key==='douyin_video_discovery'
  &&spec?.profile==='cloud-phone-test'&&spec.target==='mmv'&&spec.policy?.schema_version===2
  &&spec.policy.instance_id==='mmv-cloud-epoch2'&&spec.policy.endpoint==='tcp:127.0.0.1:5042'
  &&d?.target==='mmv'&&d.environment==='staging:'+d.source_commit&&spec.source_commit===d.source_commit);
 const scopeRun=spec.run_id?.replace(/__a1$/,'');
 const runId=p?p.run_id:scopeRun;
 need(uuid.test(runId||'')&&scopeRun===runId&&(!p||p.protocol==='workflow-domain/v1'&&p.machine_id==='us-mac-m4'));
 return runId;
}

const pathValid=p=>typeof p==='string'&&p.split('/').every(v=>/^[A-Za-z0-9_.-]+$/.test(v)&&v!=='.'&&v!=='..');
function sourceValid(s){return s&&commit.test(s.commit||'')&&s.files&&typeof s.files==='object'&&!Array.isArray(s.files)&&Object.keys(s.files).length>0&&Object.entries(s.files).every(([p,h])=>pathValid(p)&&sha.test(h||''));}
export function epochSourceCompatibilityReference(frozen){
 const ref=frozen.epoch_source_compatibility;if(ref===undefined)return null;
 const cloud=isCloudEpochSourceCompatibility(ref),r=ref?.receipt;
 if(cloud){
  need(r.business_run_id===cloudDiscoveryRun(frozen)&&sha.test(r.candidate_release_manifest_sha256||'')
   &&uuid.test(r.original?.release_id||'')&&uuid.test(r.original?.observation_id||'')&&sha.test(r.original?.manifest_sha256||'')
   &&Object.keys(r.original).sort().join(',')==='manifest_sha256,observation_id,release_id'
   &&r.original_runtime_source?.commit!==r.candidate_runtime_source?.commit
   &&r.original.release_id!==r.release_id&&r.original.observation_id!==r.observation_id);
 }else need(r?.protocol==='epoch-source-compatibility/v1'&&frozen.standalone_skill?.protocol==='codex-exec-v1'
  &&frozen.public_domain===undefined&&frozen.execution_mode==='agent'&&frozen.primary_host==='codex-exec-v1');
 const taskId=frozen.standalone_skill?.task_id??frozen.public_domain?.task_id;
 need(uuid.test(ref?.review_task_id||'')&&ref.review_task_id!==taskId&&sha.test(ref.receipt_sha256||'')&&digest(ref.receipt)===ref.receipt_sha256);
 need(sha.test(r.original_record_sha256||'')&&sourceValid(r.original_runtime_source)&&sourceValid(r.candidate_runtime_source)
  &&sha.test(r.candidate_manifest_sha256||'')&&uuid.test(r.release_id||'')&&uuid.test(r.observation_id||'')&&typeof r.serial==='string'&&r.serial
  &&typeof r.instance_id==='string'&&r.instance_id&&sha.test(r.policy_sha256||'')&&Array.isArray(r.changes)
  &&Array.isArray(r.evidence_refs)&&r.evidence_refs.length>0&&r.evidence_refs.every(v=>typeof v==='string'&&v.trim())&&typeof r.actor==='string'&&r.actor.trim());
 return ref;
}
export function compatibilityReviewProjection(task){
 return task&&{id:task.id,status:task.status,task_type:task.task_type,parent_task_id:task.parent_task_id,payload:task.payload&&Object.fromEntries(['work_kind','reviewer','business_task_id','business_run_id','candidate_source_commit','original_record_sha256','development_task_id'].map(k=>[k,task.payload[k]])),actor:task.result?.actor,audit_evidence:task.result?.audit_evidence,receipt:task.result?.epoch_source_compatibility};
}
export function epochCompatibilityRecordScope(frozen){
 const ref=epochSourceCompatibilityReference(frozen),spec=phone(frozen);
 // 只验证原record的资源与原source，不改历史record；正式授权仍需下方fresh Brain读回。
 return ref?{...spec,source_commit:ref.receipt.original_runtime_source.commit}:spec;
}
export function verifyEpochSourceCompatibility({frozen,record,recordSha256,source,reviewTask,developmentTask}){
 const ref=epochSourceCompatibilityReference(frozen);need(ref);const r=ref.receipt,spec=phone(frozen),p=reviewTask?.payload,audit=reviewTask?.result?.audit_evidence;
 const cloud=isCloudEpochSourceCompatibility(ref),taskId=cloud?frozen.public_domain?.task_id:frozen.standalone_skill.task_id;
 const claimer=cloud?'common-runner':frozen.standalone_skill.claimer;
 need(reviewTask?.task_type==='research'&&(p?.work_kind==='epoch_source_compatibility_review'||p?.work_kind==='coding_review')&&p.reviewer===r.actor
  &&(cloud?uuid.test(taskId||'')&&p.business_run_id===r.business_run_id:p.business_task_id===taskId)
  &&p.candidate_source_commit===source?.commit&&p.original_record_sha256===r.original_record_sha256
  &&uuid.test(p.development_task_id||'')&&reviewTask.parent_task_id===p.development_task_id&&p.development_task_id!==taskId
  &&developmentTask?.id===p.development_task_id&&(developmentTask.task_type==='dev'||(developmentTask.task_type==='harness_initiative'&&developmentTask.payload?.requested_task_type==='dev'&&developmentTask.payload?.work_kind==='coding_mutation'))
  &&typeof claimer==='string'&&r.actor!==claimer
  &&audit&&typeof audit.path==='string'&&audit.path.trim()&&sha.test(audit.sha256||'')&&audit.verdict==='pass'&&r.evidence_refs.includes(audit.path));
 need(reviewTask?.id===ref.review_task_id&&reviewTask.status==='completed'&&reviewTask.result?.actor===r.actor&&same(reviewTask.result?.epoch_source_compatibility,r));
 need(recordSha256===r.original_record_sha256&&spec?.policy_binding?.epoch_fence?.sha256===recordSha256&&same(record.runtime_source,r.original_runtime_source)
  &&same(source,r.candidate_runtime_source)&&source.commit===frozen.deployment?.source_commit&&spec.source_commit===source.commit
  &&r.release_id===frozen.release?.id&&r.observation_id===frozen.deployment?.observation_id&&r.serial===spec.serial&&r.serial===record.resource?.serial
  &&r.instance_id===spec.policy?.instance_id&&r.instance_id===record.new_route?.instance_id&&r.policy_sha256===spec.policy_binding?.policy_sha256&&r.policy_sha256===record.new_route?.policy_sha256);
 if(cloud){
  const ship=developmentTask.result?.ship_candidate;
  need(record.authority_basis==='approved-existing-cloud-route-fence/v1'
   &&r.original.release_id===record.cloud_migration?.release_id&&r.original.observation_id===record.cloud_migration?.observation_id
   &&r.candidate_release_manifest_sha256===frozen.release.manifest_sha256
   &&ship?.schema_version===1&&ship.stage==='candidate'&&ship.task_id===developmentTask.id
   &&ship.repo==='perfectuser21/zenithjoy-workspace'
   &&[ship.head_sha,developmentTask.result?.merge_sha].includes(source.commit)
   &&typeof ship.actor==='string'&&ship.actor.trim()&&ship.actor!==r.actor);
 }
 const runtime=Object.fromEntries(Object.entries(frozen.files||{}).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
 need(Object.keys(runtime).length>0&&r.candidate_manifest_sha256===digest(runtime));
 const before=r.original_runtime_source.files,after=source.files,expected=Object.keys({...before,...after}).sort().filter(p=>before[p]!==after[p]).map(path=>({path,before_sha256:before[path]??null,after_sha256:after[path]??null}));
 need(r.changes.every(c=>c&&pathValid(c.path)&&Object.keys(c).sort().join(',')==='after_sha256,before_sha256,path'&&(c.before_sha256===null||sha.test(c.before_sha256||''))&&(c.after_sha256===null||sha.test(c.after_sha256||'')))&&same([...r.changes].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),expected));
 return true;
}

export function verifyCloudEpochSuccessorDeployment(frozen, current){
 const ref=epochSourceCompatibilityReference(frozen);need(isCloudEpochSourceCompatibility(ref));
 const {release,observation,gate}=current??{},r=ref.receipt,d=frozen.deployment;
 need(same(release?.payload,frozen.release?.payload)&&release?.id===r.release_id&&release.target==='mmv'
  &&release.environment===d.environment&&release.manifest_sha256===r.candidate_release_manifest_sha256
  &&release.manifest_sha256===digest({environment:release.environment,target:release.target,payload:release.payload})
  &&Array.isArray(release.payload?.components)&&release.payload.components.some(c=>c.kind==='repo'&&c.repo==='perfectuser21/zenithjoy-workspace'&&c.revision===d.source_commit)
  &&observation?.id===r.observation_id&&observation.release_id===r.release_id
  &&observation.payload?.target==='mmv'&&observation.payload.environment===d.environment
  &&observation.payload_sha256===digest(observation.payload)
  &&same(observation.payload.components,release.payload.components)
  &&gate?.release_id===r.release_id&&gate.current_observation_id===r.observation_id&&gate.current_status==='deployed'
  &&gate.actual_matches===true&&gate.deployed===true&&Array.isArray(gate.gaps)&&gate.gaps.length===0
  &&gate.verification?.status==='verified'&&gate.verification?.ci_status==='verified');
 return true;
}
