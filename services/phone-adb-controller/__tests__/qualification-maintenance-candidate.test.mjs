import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../runtime-definition.mjs';
import {bindingComponents} from '../deployment-targets.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-candidate.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture(){
 const {scope}=authorityFixture(),source=scope.maintenance_source,repo='perfectuser21/zenithjoy-workspace',sha=source.commit,calls=[];
 const bytes=Buffer.from('isolated fixture, not a real candidate\n'),path='services/phone-adb-controller/qualification-maintenance.mjs';
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const row=(n,payload)=>({id:id(n),source_repo:repo,source_path:'fixture-contract.json',source_commit:sha,payload,payload_sha256:digest({source:{repo,path:'fixture-contract.json',commit:sha},payload})});
 const keys=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach','workflow_report.internal','workflow_commander.internal','douyin_video_publish.android'];
 const releases={},observations={},gates={},physical={};
 for(const [target,count]of [['mmv',7],['xian-m4',4]]){
  const refs=source.releases[target],activities=keys.slice(0,count).map((key,i)=>row(100+i,{activity_id:id(200+i),implementation_bindings:[{kind:'code',status:'verified',repo,revision:sha,path,digest:'sha256:'+digest(bytes)}]}));
  const workflows=keys.slice(0,count).map((key,i)=>row(300+i,{workflow_id:i<4?`b1000000-0000-4000-8000-${String(101+i).padStart(12,'0')}`:id(400+i),key,activities:[{activity_id:activities[i].payload.activity_id,activity_version_id:activities[i].id}]}));
  workflows.forEach(w=>w.workflow_id=w.payload.workflow_id);activities.forEach(a=>a.activity_id=a.payload.activity_id);
  const payload={workflows,activities,verification:{status:'verified'}};payload.components=bindingComponents(payload,sha);
  const release={id:refs.id,target,environment:source.environment,payload};release.manifest_sha256=digest({target,environment:source.environment,payload});releases[target]=release;
  const op={target,environment:source.environment,components:payload.components,attempt_key:'fixture-admission'};
  observations[target]={id:refs.observation_id,release_id:refs.id,payload:op,payload_sha256:digest(op)};
  gates[target]={release_id:refs.id,deployed:true,actual_matches:true,current_status:'deployed',current_observation_id:refs.observation_id,gaps:[]};
  const manifest={schema_version:1,source_repo:repo,source_commit:sha,target,environment:source.environment,release_id:refs.id,observation_id:refs.observation_id,files:[{path,deployed_path:'qualification-maintenance.mjs',content_sha256:digest(bytes)}]};
  const raw=Buffer.from(JSON.stringify(manifest));refs.manifest_raw_sha256=digest(raw);
  physical[target]={manifest_raw:raw.toString('base64'),observed:{source_repo:repo,source_commit:sha,files:manifest.files}};
 }
 const request=async path=>{calls.push(path);const target=Object.keys(releases).find(t=>path.startsWith('/releases/'+releases[t].id));assert.ok(target);return path.endsWith('/gate')?gates[target]:path.includes('/observations/')?{observation:observations[target]}:{release:releases[target]};};
 return {scope,calls,releases,observations,gates,physical,request,collect:async target=>physical[target]};
}
test('新维护候选只核正常双机六GET/真实bytes，不要求先通过整个production业务',async()=>{
 const f=fixture();assert.equal(typeof api?.verifyMaintenanceCandidate,'function');const r=await api.verifyMaintenanceCandidate({scope:f.scope},{request:f.request,collect:f.collect});
 assert.equal(r.status,'verified');assert.equal(r.business_outcome,'not_evaluated');assert.equal(f.calls.length,6);assert.ok(f.calls.every(p=>!p.includes('runs/')));
});
for(const [name,change]of [
 ['candidateSHA漂移',f=>f.scope.maintenance_source.commit='d'.repeat(40)],
 ['gate未安装',f=>f.gates.mmv.deployed=false],
 ['observation漂移',f=>f.gates['xian-m4'].current_observation_id='other'],
 ['observation正文变',f=>f.observations.mmv.payload.target='other'],
 ['manifest原字节变',f=>f.physical.mmv.manifest_raw=Buffer.from('{}').toString('base64')],
 ['文件未实取',f=>f.physical['xian-m4'].observed.files=[]],
])test(name+'不能拿六GET绿洗成bytes准入',async()=>{
 const f=fixture();change(f);assert.equal(typeof api?.verifyMaintenanceCandidate,'function');await assert.rejects(api.verifyMaintenanceCandidate({scope:f.scope},{request:f.request,collect:f.collect}));
});
