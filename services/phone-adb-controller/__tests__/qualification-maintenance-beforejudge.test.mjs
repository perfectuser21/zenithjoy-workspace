import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../runtime-definition.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-beforejudge.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture() {
 const {scope}=authorityFixture(),runId='douyin_video_processing-'+scope.run_tag+'__a1';
 const body={deployment:{source_repo:'perfectuser21/zenithjoy-workspace',source_commit:scope.consumer_source,target:'xian-m4'},
  run_identity:{capability:'douyin_video_processing',tag:scope.run_tag,profile:scope.profile,serial:scope.serial,run_id:'douyin_video_processing-'+scope.run_tag},
  sampling_input:{workflow_key:'douyin_video_processing',run_tag:scope.run_tag,profile:scope.profile,serial:scope.serial,line:scope.line_key,source_run:scope.producer_run,comment_limit:5,collection_budget_s:480},
  producer_descriptor:{schema_version:2,company_id:scope.company_id,tenant_id:scope.tenant_id,company_config_version:scope.config_version,policy_id:scope.policy_id,run_tag:scope.producer_run,video_ids:scope.video_ids,profile:scope.profile,serial:scope.serial},
  activities:['preflight','dedup','qualification','collection','cleanup'].map(slot=>({reference:{slot_key:slot},version:{source_commit:scope.consumer_source}}))};
 const frozen={...body,snapshot_sha256:digest(body)};scope.snapshot_sha256=frozen.snapshot_sha256;
 const sampling_input=body.sampling_input;
 const split={status:'failed',task_id:null,source_commit:scope.consumer_source,run_id:runId,binding_id:scope.binding_id,profile:scope.profile,sampling_input,
  results:[{activity:'preflight',status:'completed'},{activity:'dedup',status:'completed'},{activity:'qualification',status:'failed',error:'OLD_EXECUTION_TERMINATION_UNKNOWN'},{activity:'collection',status:'blocked'},{activity:'cleanup',status:'blocked'}]};
 const qualification={activity:'qualification',status:'failed',attempt:1,error:'OLD_EXECUTION_TERMINATION_UNKNOWN',execution_stopped:false};
 const native={operation_id:'11111111-1111-4111-8111-111111111112',activity:'qualification',run_id:runId,source_commit:scope.consumer_source,profile:scope.profile,serial:scope.serial,owner:scope.run_tag,status:'unknown',execution_stopped:false,wait_code:5,wait_signal:null};
 const progress={run:scope.run_tag,source_commit:scope.consumer_source,leased_video_ids:scope.video_ids,qualified_video_ids:[],videos:[{video_id:scope.video_ids[0],settled:false,attempts:1}]};
 const root='/private/tmp/openclaw-phone/evidence/'+scope.profile;
 const tsv=`AUDIO\\t${scope.video_ids[0]}\\t${root}/${scope.run_tag}-v${scope.video_ids[0]}-qualification-record.16k.wav\nQUAL\t${scope.video_ids[0]}\tpending\taudio_upload_failed\n`;
 return {scope,frozen,split,qualification,native_records:[native],progress,tsv};
}
test('结构交叉验证保真实raw task_id null与旧UNKNOWN；结果不叫停止证明',()=>{
 const f=fixture(),before=digest(f);assert.equal(typeof api?.verifyBeforeJudgeEvidence,'function');
 const r=api.verifyBeforeJudgeEvidence(f);assert.equal(r.status,'beforejudge_evidence_consistent');assert.equal(r.execution_stopped,false);assert.equal(digest(f),before);
});
for(const [name,mutate]of [
 ['快照digest变',f=>f.frozen.snapshot_sha256='0'.repeat(64)],
 ['source变',f=>f.native_records[0].source_commit='0'.repeat(40)],
 ['错误native出口',f=>f.native_records[0].wait_code=0],
 ['两个资格native',f=>f.native_records.push({...f.native_records[0],operation_id:'other'})],
 ['collection执行已发生',f=>f.split.results.find(x=>x.activity==='collection').status='failed'],
 ['collection native已发生',f=>f.native_records.push({...f.native_records[0],activity:'collection'})],
 ['已有合格视频',f=>f.progress.qualified_video_ids=[f.scope.video_ids[0]]],
 ['binding错',f=>f.split.binding_id='other'],
 ['外部Task关联错',f=>f.split.task_id='other'],
 ['额外stdout行',f=>f.tsv+='QUAL\tother\tmatched\n'],
])test(name+'不能声称固定353 beforejudge成立',()=>{
 const f=fixture();mutate(f);assert.equal(typeof api?.verifyBeforeJudgeEvidence,'function');assert.throws(()=>api.verifyBeforeJudgeEvidence(f),/MAINTENANCE_/);
});
