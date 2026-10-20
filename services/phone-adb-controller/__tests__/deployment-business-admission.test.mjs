import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyBusinessAdmission} from '../deployment-business-admission.mjs';
const sha='a'.repeat(40), repo='perfectuser21/zenithjoy-workspace';
const definitions={workflows:[{id:'wf-version',workflow_id:'wf',source_repo:repo,source_commit:sha,payload_sha256:'f'.repeat(64),payload:{key:'douyin_video_processing'}}],activities:[]};
function context(){
 const release={id:'candidate-release',environment:'staging',target:'xian-m4',payload:{...definitions,components:[{kind:'repo',repo,revision:sha}]}};
 const binding={id:'binding',run_id:'sample__a1',release_id:release.id,workflow_definition_version_id:'wf-version',workflow_id:'wf',snapshot_sha256:'f'.repeat(64),observation_id:'obs'};
 const reconciliation={run_id:'sample__a1',run_binding_id:'binding',release_id:release.id,business_outcome:'pass',evidence_status:'verified',gaps:[],missing:[],unexpected:[],span_count:8,expected_count:8};
 const requests=[];const request=async path=>{
  requests.push(path);
  if(path.endsWith('/definition'))return {binding,release,workflow:definitions.workflows[0]};
  if(path.endsWith('/reconciliation'))return reconciliation;
  if(path==='/api/brain/releases/candidate-release')return {release};
  if(path.endsWith('/gate'))return {release_id:release.id,deployed:true,actual_matches:true,current_observation_id:'obs'};
  throw Error('unexpected read '+path);
 };
 return {release,binding,reconciliation,requests,request};
}
test('同候选SHA真实完整业务对账准入；全程只读Brain',async()=>{
 const f=context();const result=await verifyBusinessAdmission({sha,targets:{'xian-m4':{definitions}},runIds:['sample__a1'],request:f.request});
 assert.equal(result.runs[0].run_id,'sample__a1');assert.ok(f.requests.some(p=>p.endsWith('/reconciliation')));
});
for(const change of [
 f=>{f.reconciliation.business_outcome='fail';},
 f=>{f.reconciliation.evidence_status='incomplete';},
 f=>{f.reconciliation.gaps=[{code:'EXPECTED_SPAN_MISSING'}];},
 f=>{f.reconciliation.expected_count=0;},
 f=>{f.reconciliation.run_binding_id='another';},
 f=>{f.binding.workflow_definition_version_id='old';},
 f=>{f.release.environment='production';},
 f=>{f.release.payload.components[0].revision='b'.repeat(40);},
])test('安装成功也不能代替候选真实业务验收 '+change.toString(),async()=>{
 const f=context();change(f);
 await assert.rejects(verifyBusinessAdmission({sha,targets:{'xian-m4':{definitions}},runIds:['sample__a1'],request:f.request}));
});
test('空清单和任意本地PASS没有生产准入效果',async()=>{
 await assert.rejects(verifyBusinessAdmission({sha,targets:{'xian-m4':{definitions}},runIds:[],request:async()=>({verdict:'PASS'})}));
});
