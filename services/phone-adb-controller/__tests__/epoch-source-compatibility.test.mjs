import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../runtime-definition.mjs';
import {verifyEpochSourceCompatibility,epochCompatibilityRecordScope,compatibilityReviewProjection} from '../epoch-source-compatibility.mjs';
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function fixture(){
 const original={commit:'a'.repeat(40),files:{'unchanged.mjs':'1'.repeat(64),'changed.mjs':'2'.repeat(64),'removed.mjs':'3'.repeat(64)}},source={commit:'b'.repeat(40),files:{'unchanged.mjs':'1'.repeat(64),'changed.mjs':'4'.repeat(64),'new.mjs':'5'.repeat(64)}},recordSha256='6'.repeat(64),policy='7'.repeat(64),serial='192.0.2.1:10001',instance='fixture',runtime={'tool.mjs':'8'.repeat(64)};
 const receipt={protocol:'epoch-source-compatibility/v1',original_record_sha256:recordSha256,original_runtime_source:structuredClone(original),candidate_runtime_source:structuredClone(source),candidate_manifest_sha256:digest(runtime),release_id:id('1'),observation_id:id('2'),serial,instance_id:instance,policy_sha256:policy,changes:[{path:'changed.mjs',before_sha256:'2'.repeat(64),after_sha256:'4'.repeat(64)},{path:'new.mjs',before_sha256:null,after_sha256:'5'.repeat(64)},{path:'removed.mjs',before_sha256:'3'.repeat(64),after_sha256:null}],evidence_refs:['artifact://diff-review'],actor:'fixture-independent-reviewer'};
 const frozen={execution_mode:'agent',primary_host:'codex-exec-v1',standalone_skill:{protocol:'codex-exec-v1',task_id:id('3'),claimer:'fixture-business-executor'},deployment:{source_commit:source.commit,observation_id:receipt.observation_id},release:{id:receipt.release_id},files:{'runtime/tool.mjs':runtime['tool.mjs']},discovery_phone_scope:{source_commit:source.commit,serial,policy:{instance_id:instance},policy_binding:{epoch_fence:{sha256:recordSha256},policy_sha256:policy}},epoch_source_compatibility:{review_task_id:id('4'),receipt,receipt_sha256:digest(receipt)}};
 return {frozen,source,recordSha256,record:{runtime_source:original,resource:{serial},new_route:{instance_id:instance,policy_sha256:policy}},reviewTask:{id:id('4'),status:'completed',task_type:'research',parent_task_id:id('5'),payload:{work_kind:'epoch_source_compatibility_review',reviewer:receipt.actor,business_task_id:id('3'),candidate_source_commit:source.commit,original_record_sha256:recordSha256,development_task_id:id('5')},result:{actor:receipt.actor,audit_evidence:{path:'artifact://diff-review',sha256:'9'.repeat(64),verdict:'pass'},epoch_source_compatibility:structuredClone(receipt)}},developmentTask:{id:id('5'),task_type:'dev'}};
}
function approveChangedReceipt(f,change){change(f.frozen.epoch_source_compatibility.receipt);f.frozen.epoch_source_compatibility.receipt_sha256=digest(f.frozen.epoch_source_compatibility.receipt);f.reviewTask.result.epoch_source_compatibility=structuredClone(f.frozen.epoch_source_compatibility.receipt);}
test('compatibility receipt pins add/change/delete file review and original record without rewriting either',()=>{
 const f=fixture(),original=structuredClone(f.record);assert.equal(verifyEpochSourceCompatibility(f),true);
 const scope=epochCompatibilityRecordScope(f.frozen);assert.equal(scope.source_commit,f.record.runtime_source.commit);assert.equal(f.frozen.discovery_phone_scope.source_commit,f.source.commit);assert.deepEqual(f.record,original);
});
test('completed but mismatched candidate/resource/file coverage receipt grants no compatibility',()=>{
 for(const change of [r=>r.original_record_sha256='0'.repeat(64),r=>r.original_runtime_source.commit='c'.repeat(40),r=>r.candidate_runtime_source.files['unchanged.mjs']='0'.repeat(64),r=>r.candidate_manifest_sha256='0'.repeat(64),r=>r.release_id=id('5'),r=>r.observation_id=id('5'),r=>r.serial='another',r=>r.instance_id='another',r=>r.policy_sha256='0'.repeat(64),r=>r.changes.pop(),r=>r.changes.push({...r.changes[0]}),r=>r.changes[0].before_sha256='0'.repeat(64),r=>r.changes[1].after_sha256=null,r=>r.evidence_refs=[],r=>r.actor='']){
  const f=fixture();approveChangedReceipt(f,change);assert.throws(()=>verifyEpochSourceCompatibility(f),/EPOCH_SOURCE_COMPATIBILITY/);
 }
});
test('compatibility cannot be borrowed by old execution modes or self-reviewed business Task',()=>{
 for(const change of [f=>delete f.frozen.standalone_skill,f=>f.frozen.public_domain={protocol:'workflow-domain/v1'},f=>f.frozen.primary_host='official-child-v1',f=>f.frozen.epoch_source_compatibility.review_task_id=f.frozen.standalone_skill.task_id,f=>f.reviewTask.result.actor='different-reviewer',f=>delete f.reviewTask,f=>f.reviewTask.status='failed']){const f=fixture();change(f);assert.throws(()=>verifyEpochSourceCompatibility(f),/EPOCH_SOURCE_COMPATIBILITY/);}
});
test('fresh review authority projection ignores timestamps and observes withdrawal or receipt/actor drift',()=>{
 const f=fixture(),before=compatibilityReviewProjection(f.reviewTask),later=structuredClone(f.reviewTask);later.updated_at='later';later.result.progress={heartbeat:1};assert.deepEqual(compatibilityReviewProjection(later),before);
 for(const change of [v=>v.status='in_progress',v=>v.task_type='dev',v=>v.parent_task_id=id('6'),v=>v.payload.business_task_id=id('6'),v=>v.result.actor='another',v=>v.result.audit_evidence.sha256='0'.repeat(64),v=>v.result.epoch_source_compatibility.candidate_manifest_sha256='0'.repeat(64)]){const x=structuredClone(later);change(x);assert.notDeepEqual(compatibilityReviewProjection(x),before);}
});

test('ordinary completed Tasks, self-review and out-of-scope review cannot approve a candidate',()=>{
 for(const change of [f=>f.reviewTask.task_type='dev',f=>delete f.reviewTask.payload,f=>f.reviewTask.payload.work_kind='ordinary_research',f=>f.reviewTask.payload.reviewer='another',f=>f.reviewTask.payload.business_task_id=id('6'),f=>f.reviewTask.payload.candidate_source_commit='c'.repeat(40),f=>f.reviewTask.payload.original_record_sha256='0'.repeat(64),f=>f.reviewTask.parent_task_id=id('6'),f=>f.reviewTask.payload.development_task_id=f.frozen.standalone_skill.task_id,f=>f.frozen.standalone_skill.claimer=f.reviewTask.result.actor,f=>delete f.reviewTask.result.audit_evidence,f=>f.reviewTask.result.audit_evidence.verdict='fail',f=>f.reviewTask.result.audit_evidence.sha256='invalid',f=>f.reviewTask.result.audit_evidence.path='artifact://unlisted',f=>f.developmentTask.task_type='research',f=>f.developmentTask.id=id('6'),f=>delete f.developmentTask]){
  const f=fixture();change(f);assert.throws(()=>verifyEpochSourceCompatibility(f),/EPOCH_SOURCE_COMPATIBILITY/);
 }
});

test('Brain canonical coding review and explicitly requested dev mutation retain exact compatibility bindings',()=>{
 const f=fixture();f.reviewTask.payload.work_kind='coding_review';f.developmentTask.task_type='harness_initiative';f.developmentTask.payload={requested_task_type:'dev',work_kind:'coding_mutation'};
 assert.equal(verifyEpochSourceCompatibility(f),true);
 for(const change of [x=>x.developmentTask.payload.requested_task_type='research',x=>delete x.developmentTask.payload.requested_task_type,x=>x.developmentTask.payload.work_kind='coding_review',x=>delete x.developmentTask.payload,x=>x.developmentTask.task_type='coding_workflow',x=>x.reviewTask.task_type='dev',x=>x.reviewTask.payload.work_kind='coding_mutation',x=>x.reviewTask.payload.reviewer='another',x=>x.reviewTask.payload.business_task_id=id('6'),x=>x.reviewTask.payload.candidate_source_commit='c'.repeat(40),x=>x.reviewTask.payload.original_record_sha256='0'.repeat(64),x=>x.reviewTask.payload.development_task_id=id('6'),x=>x.reviewTask.parent_task_id=id('6'),x=>x.reviewTask.status='in_progress',x=>x.reviewTask.result.actor='another',x=>x.reviewTask.result.audit_evidence.verdict='fail']){
  const changed=structuredClone(f);change(changed);assert.throws(()=>verifyEpochSourceCompatibility(changed),/EPOCH_SOURCE_COMPATIBILITY/);
 }
});
