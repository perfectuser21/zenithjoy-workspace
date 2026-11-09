import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifySkillRequest} from '../leadgen-skill-agent.mjs';
import {registerPublicDomainAuthority} from '../public-domain-authority.mjs';
import {digest} from '../runtime-definition.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(activityKey="scoring"){
 const dir=mkdtempSync(join(tmpdir(),'skill-public-')),source='a'.repeat(40),runtime='c'.repeat(64);
 const run_binding={run_binding_id:uuid(3),workflow_id:uuid(4),workflow_definition_version_id:uuid(5),source_kind:'internal',attempt_key:'task:1',activities:{[activityKey]:{reference_id:uuid(6),activity_id:uuid(7),activity_definition_version_id:uuid(8)}}};
 const identity={mode:'formal',run_id:uuid(1),task_id:uuid(2),machine_id:'us-mac-m4',profile_sha256:'b'.repeat(64),run_binding,input:{profile:'mmv-scoring',serial:'none',line:'main',limit:2}};
 const agent_input={schema_version:1,workflow_key:'douyin_comment_scoring',task_id:uuid(2),run_tag:'public_run',profile:'mmv-scoring',serial:'none',line:'main',source_run:null,limit:2,comment_limit:null,run_max_seconds:1800,run_start_ts:Math.floor(Date.now()/1000),discovery_filters:null,collection_budget_s:null};
 const wf={id:uuid(5),source_commit:source,payload:{key:agent_input.workflow_key,activities:[{slot_key:activityKey,reference_id:uuid(6),activity_id:uuid(7),activity_version_id:uuid(8)}]}};
 const pd={protocol:'workflow-domain/v1',run_id:identity.run_id,task_id:identity.task_id,machine_id:identity.machine_id,profile_sha256:identity.profile_sha256,run_binding,company:{tenant_id:uuid(10),company_id:uuid(11),version:1,policy_id:'original'},runtime_snapshot_sha256:runtime};
 const frozen={activities:[{reference:{slot_key:activityKey,reference_id:uuid(6)},version:{id:uuid(8),payload:{contract:{runtime:{phase:activityKey==='cleanup'?'finalize':'execute'}}}}}],execution_mode:'agent',agent_input,workflow_version:wf,public_domain:pd,files:{},deployment:{source_commit:source,target:'mmv',observation_id:uuid(13)},release:{id:uuid(12)}};
 frozen.snapshot_sha256=digest(frozen);writeFileSync(join(dir,'run-definition.json'),JSON.stringify(frozen));
 const snapshot_authority={local_snapshot_sha256:frozen.snapshot_sha256,runtime_snapshot_sha256:runtime};
 const unregister=registerPublicDomainAuthority({runDirectory:dir,identity,business_scope:{run:'public_run',run_id:identity.run_id,task_id:identity.task_id,source_commit:source,profile:'mmv-scoring',serial:'none',attempt:'a1'},snapshot_authority,deadline_ms:Date.now()+60000,cleanup_deadline_ms:Date.now()+120000});
 const av={contract_sha256:digest({budget:{max_duration_s:30}}),payload:{definition_key:'douyin_comment_scoring.scoring',contract:{budget:{max_duration_s:30}},implementation_bindings:[{kind:'skill',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:source,name:'method1',version:'1',content_sha256:'x'}]}};
 const binding={id:uuid(3),run_id:uuid(1),workflow_id:uuid(4),workflow_definition_version_id:uuid(5),source_kind:'internal',task_run_id:uuid(9),actor:'common-runner',external_origin:null,release_id:uuid(12),observation_id:uuid(13),attempt_key:'task:1',payload:{runtime_snapshot_sha256:runtime}};
 const task={id:uuid(2),status:'in_progress',claimed_by:'common-runner',result:{common_runner:{...identity}}};
 const q={...agent_input,discovery_input:null,mode:'execute',run_id:uuid(1),binding_id:uuid(3),source_commit:source,workflow_definition_version_id:uuid(5),release_id:uuid(12),observation_id:uuid(13),runtime_snapshot_sha256:frozen.snapshot_sha256,activity_key:activityKey,broker_host:'mmv',deadline_ms:Date.now()+10000,public_domain:{identity,run_binding,...{runtime_snapshot_sha256:runtime,local_snapshot_sha256:frozen.snapshot_sha256}},method:{reference_id:uuid(6),activity_version_id:uuid(8),name:'method1',version:'1',sha256:'x',text:'---\nmetadata:\n  primary_execution: agent-v1\n---\nmethod',contract:{activity_version_id:uuid(8),definition_key:av.payload.definition_key,sha256:av.contract_sha256,payload:av.payload.contract}}};
 let hook=()=>{};
 const get=async path=>{await hook(path);if(path.endsWith('/definition'))return {binding};if(path.endsWith('/reconciliation'))return {run_id:uuid(1),run_binding_id:uuid(3),task_run:{id:uuid(9),run_id:uuid(1),task_id:uuid(2),status:'running',ended_at:null},links:{task_run_id:uuid(9),task_id:uuid(2)}};if(path.includes('/tasks/'))return {task};if(path.includes('/workflows/'))return {version:wf};return {version:av};};
 return {q,get,task,binding,unregister,setHook:fn=>hook=fn,options:{get,verifyMethod:()=>true,publicRunDirectory:dir},close(){unregister();rmSync(dir,{recursive:true,force:true});}};
}
test('公共首发严格同live授权、内部binding、冻结输入及Method通过',async()=>{const x=fixture();try{assert.equal(await verifySkillRequest(x.q,x.options),true);}finally{x.close();}});
test('公共标记不能独自绕过legacy来源门',async()=>{const x=fixture();try{await assert.rejects(()=>verifySkillRequest(x.q,{get:x.get,verifyMethod:()=>true}));}finally{x.close();}});
test('公共源、TaskRun归属、完整身份及输入篡改均拒绝',async()=>{const x=fixture();try{for(const mutate of [q=>q.public_domain.identity.machine_id='other',q=>q.limit=3,q=>q.line='other',q=>q.public_domain.runtime_snapshot_sha256='f'.repeat(64),q=>q.public_domain.local_snapshot_sha256='f'.repeat(64),q=>q.method.reference_id=uuid(20)]){const q=structuredClone(x.q);mutate(q);await assert.rejects(()=>verifySkillRequest(q,x.options));}x.binding.actor='other';await assert.rejects(()=>verifySkillRequest(x.q,x.options));}finally{x.close();}});
test('中央AV await期间Task取消或本地授权撤销不可放行',async()=>{for(const revoke of [x=>x.task.status='cancelled',x=>x.unregister()]){const x=fixture();try{x.setHook(path=>{if(path.includes('/activities/'))revoke(x);});await assert.rejects(()=>verifySkillRequest(x.q,x.options));}finally{x.close();}}});

test('中央回执必须同run同binding同TaskRun且仍running',async()=>{for(const mutate of [v=>v.run_id=uuid(30),v=>v.run_binding_id=uuid(30),v=>v.links.task_id=uuid(30),v=>v.task_run.task_id=uuid(30),v=>v.task_run.status='completed',v=>v.task_run.ended_at=new Date().toISOString()]){const x=fixture();try{const get=async path=>{const value=await x.get(path);if(path.endsWith('/reconciliation'))mutate(value);return value;};await assert.rejects(()=>verifySkillRequest(x.q,{...x.options,get}));}finally{x.close();}}});
test('末次Task查询await期间撤销Map仍拒绝，过期请求不新增动作',async()=>{const x=fixture();try{x.setHook(path=>{if(path.includes('/tasks/'))x.unregister();});await assert.rejects(()=>verifySkillRequest(x.q,x.options));}finally{x.close();}const y=fixture();try{await assert.rejects(()=>verifySkillRequest({...y.q,deadline_ms:Date.now()-1},y.options));}finally{y.close();}});

test('只有冻结finalize cleanup可用收尾预算，普通Activity不可延寿',async()=>{const now=Date.now;const x=fixture('cleanup'),y=fixture();try{const advanced=now()+65000;x.q.deadline_ms=advanced+5000;y.q.deadline_ms=advanced+5000;Date.now=()=>advanced;assert.equal(await verifySkillRequest(x.q,x.options),true);await assert.rejects(()=>verifySkillRequest(y.q,y.options));}finally{Date.now=now;x.close();y.close();}});

test('正式official control经受控runtimeRoot与真实本机HTTP完成公共授权',async()=>{
 const {using}=await import('./fixtures/official-control-fixture.mjs');
 await using(async({instance,q:legacy,options,createControl,routes,runtimeRoot,journalDirectory,count})=>{
  await instance.close();
  const {dirname}=await import('node:path'),{mkdirSync}=await import('node:fs'),{pathToFileURL}=await import('node:url');
  const dir=dirname(runtimeRoot),q=structuredClone(legacy),oldBinding=routes.get('/api/brain/runs/'+legacy.run_id+'/definition').binding;
  Object.assign(q,{run_id:uuid(1),binding_id:uuid(3),workflow_definition_version_id:uuid(5),release_id:uuid(12),observation_id:uuid(13)});
  Object.assign(q.method,{reference_id:uuid(6),activity_version_id:uuid(8)});q.method.contract.activity_version_id=uuid(8);
  const run_binding={run_binding_id:q.binding_id,workflow_id:uuid(4),workflow_definition_version_id:q.workflow_definition_version_id,source_kind:'internal',attempt_key:'task:1',activities:{[q.activity_key]:{reference_id:uuid(6),activity_id:uuid(7),activity_definition_version_id:uuid(8)}}};
  const identity={mode:'formal',run_id:q.run_id,task_id:q.task_id,machine_id:'us-mac-m4',profile_sha256:'b'.repeat(64),run_binding,input:{profile:q.profile,serial:q.serial,line:q.line}};
  const agent_input={schema_version:1,workflow_key:q.workflow_key,task_id:q.task_id,run_tag:q.run_tag,profile:q.profile,serial:q.serial,line:q.line,source_run:q.source_run,limit:q.limit,comment_limit:q.comment_limit,run_max_seconds:q.run_max_seconds,run_start_ts:Math.floor(Date.now()/1000),discovery_filters:q.discovery_filters,collection_budget_s:null,execution_transport:q.execution_transport,max_turns:q.max_turns};
  const oldWf=routes.get('/api/brain/workflows/w1/versions/wv1').version,oldAv=routes.get('/api/brain/activities/a1/versions/av1').version;
  const wf={...oldWf,id:uuid(5),payload:{...oldWf.payload,activities:[{slot_key:q.activity_key,reference_id:uuid(6),activity_id:uuid(7),activity_version_id:uuid(8)}]}};
  const runtime='c'.repeat(64),pd={...identity,runtime_snapshot_sha256:runtime,company:{tenant_id:uuid(10),company_id:uuid(11),version:1,policy_id:'original'}};
  const frozen={execution_mode:'agent',execution_transport:q.execution_transport,max_turns:q.max_turns,agent_input,workflow_version:wf,public_domain:pd,files:{},deployment:{source_commit:q.source_commit,target:'mmv',observation_id:q.observation_id},release:{id:q.release_id}};frozen.snapshot_sha256=digest(frozen);
  writeFileSync(join(dir,'run-definition.json'),JSON.stringify(frozen));q.runtime_snapshot_sha256=frozen.snapshot_sha256;q.public_domain={identity,run_binding,runtime_snapshot_sha256:runtime,local_snapshot_sha256:frozen.snapshot_sha256};
  const authority=await import(pathToFileURL(join(runtimeRoot,'public-domain-authority.mjs')).href),unregister=authority.registerPublicDomainAuthority({runDirectory:dir,identity,business_scope:{run:q.run_tag,run_id:q.run_id,task_id:q.task_id,source_commit:q.source_commit,profile:q.profile,serial:q.serial,attempt:'a1'},snapshot_authority:{local_snapshot_sha256:frozen.snapshot_sha256,runtime_snapshot_sha256:runtime},deadline_ms:q.deadline_ms+1000,cleanup_deadline_ms:q.deadline_ms+2000});
  const binding={...oldBinding,id:q.binding_id,run_id:q.run_id,workflow_id:uuid(4),workflow_definition_version_id:uuid(5),release_id:q.release_id,observation_id:q.observation_id,source_kind:'internal',actor:'common-runner',external_origin:null,task_run_id:uuid(9),attempt_key:'task:1',runtime_snapshot_sha256:runtime};
  routes.set('/api/brain/runs/'+q.run_id+'/definition',{binding});routes.set('/api/brain/workflows/'+uuid(4)+'/versions/'+uuid(5),{version:wf});routes.set('/api/brain/activities/'+uuid(7)+'/versions/'+uuid(8),{version:oldAv});
  routes.set('/api/brain/runs/'+q.run_id+'/reconciliation',{run_id:q.run_id,run_binding_id:q.binding_id,links:{task_run_id:uuid(9),task_id:q.task_id},task_run:{id:uuid(9),run_id:q.run_id,task_id:q.task_id,status:'running',ended_at:null}});
  const task=routes.get('/api/brain/tasks/'+q.task_id);task.claimed_by='common-runner';task.result={common_runner:{...identity}};
  const journal=join(journalDirectory,'public');mkdirSync(journal,{mode:0o700});const control=createControl({...options,request:q,journalDirectory:journal});
  try{assert.equal(await control.authorizeParentContext(q),true);assert.equal(count(),5);task.status='cancelled';await assert.rejects(()=>control.authorizeParentContext(q));assert.equal(count(),10);}finally{await control.close();unregister();}
 },{rawTransport:true});
});
