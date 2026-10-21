import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyBusinessAdmission} from '../deployment-business-admission.mjs';
const sha='a'.repeat(40), repo='perfectuser21/zenithjoy-workspace';
const definitions={workflows:[{id:'wf-version',workflow_id:'wf',source_repo:repo,source_commit:sha,payload_sha256:'f'.repeat(64),payload:{key:'douyin_video_processing'}}],activities:[]};
function context(){
 const release={id:'candidate-release',environment:'staging:'+('a'.repeat(40)),target:'xian-m4',payload:{...definitions,components:[{kind:'repo',repo,revision:sha}]}};
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
 const f=fullSkillFixture();const result=await verifyBusinessAdmission(f.args);
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
test('共享Commander由真实业务run覆盖；Activity绿但独立核验未结束不能晋级',async()=>{
 const f=context(),defs=structuredClone(definitions),workflow=defs.workflows[0];
 workflow.payload.key='workflow_report.internal';f.release.target='mmv';f.release.payload.workflows=[workflow];
 const sharedBinding={kind:'code',path:'commander/wf-v2.py',repo,revision:sha,digest:'sha256:'+'e'.repeat(64),status:'verified'};
 defs.workflows.push({id:'shared',payload_sha256:'c'.repeat(64),payload:{key:'workflow_commander.internal',activities:[{activity_version_id:'shared-activity'}]}});
 f.release.payload.workflows.push(defs.workflows[1]);
 defs.activities.push({id:'shared-activity',payload:{implementation_bindings:[sharedBinding]}});
 f.release.payload.components.push({...sharedBinding});f.binding.runtime_snapshot_sha256='d'.repeat(64);
 f.reconciliation.links={task_id:'task'};f.reconciliation.task_run={status:'success'};
 const task={id:'task',status:'completed',result:{workflow_control:{phase:'final',envelope:{definition:{release_id:f.release.id,runtime_snapshot_sha256:f.binding.runtime_snapshot_sha256}},verification:{task_id:'task',run_id:'sample__a1',definition_sha256:workflow.payload_sha256,verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['independent-source']}}}};
 const request=async path=>{
  if(path==='/api/brain/tasks/task')return task;
  if(path.endsWith('?include=spans'))return {spans:[{run_binding_id:'binding',evidence:{runtime_snapshot_sha256:f.binding.runtime_snapshot_sha256}}]};
  return f.request(path);
 };
 const args={sha,targets:{mmv:{definitions:defs}},runIds:['sample__a1'],request};
 assert.equal((await verifyBusinessAdmission(args)).runs.length,1,'不要求伪造shared协议独立run');
 task.result.workflow_control.phase='awaiting_verify';await assert.rejects(verifyBusinessAdmission(args),/独立验收/);
 task.result.workflow_control.phase='final';f.release.payload.components.pop();await assert.rejects(verifyBusinessAdmission(args),/共享Commander/);
});

// 回归真实缺口：旧 native 23/23 不等于完整 Skill；独立 task 是只读核验来源。
function fullSkillFixture(){
 const f=context(), taskId='11111111-1111-4111-8111-111111111111';
 const skill='---\nname: douyin-leadgen-102\n---\n# 102\n\n## 输入与交付\n\n输入公司与授权。\n\n## 执行\n\n1. 真实原生身份与公司一致。\n2. 评论持久化并独立读回。\n\n## 原实现的数据外发与调用记录\n\n保留真实调用记录。\n\n## Commander 与中断恢复\n\n接手不扩大授权。\n\n## 验收\n\n独立读回实际结果。\n\n## 冻结来源绑定\n\n原执行来源固定。\n';
 // 固定输入的摘要由 crypto 独立计算，不能调用被测定义生成器自证。
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const checks=[['输入与交付','输入公司与授权。'],['执行','1. 真实原生身份与公司一致。'],['执行','2. 评论持久化并独立读回。'],['原实现的数据外发与调用记录','保留真实调用记录。'],['Commander 与中断恢复','接手不扩大授权。'],['验收','独立读回实际结果。'],['冻结来源绑定','原执行来源固定。']].map(([section,text])=>({id:hash(section+'\n'+text),section,text}));
 const skillIdentity={path:'services/phone-adb-controller/skills/douyin-leadgen-102/SKILL.md',sha256:hash(skill)};
 const definition={schema_version:1,workflow_key:'douyin_video_processing',skill:skillIdentity,checks};
 const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
 f.binding.runtime_snapshot_sha256='d'.repeat(64);
 const verification={task_id:taskId,run_id:'sample__a1',definition_sha256:'f'.repeat(64),verdict:'PASS',scope:'full_skill',source_commit:sha,run_binding_id:'binding',workflow_definition_version_id:'wf-version',skill:skillIdentity,acceptance_definition_sha256:hash(canonical(definition)),assertions:checks.map(c=>({id:c.id,pass:true,evidence:['immutable://same-run/'+c.id]})),evidence:['immutable://same-run/report']};
 const task={id:taskId,status:'completed',description:'仅同城AI考证，上限2，禁止发送',payload:{acceptance:{location:'same_city',limit:2}},result:{workflow_control:{phase:'final',envelope:{definition:{release_id:'candidate-release',runtime_snapshot_sha256:'d'.repeat(64)}},verification}}};
 const execution={status:'completed',id:'22222222-2222-4222-8222-222222222222',description:task.description,payload:task.payload,result:{run_id:'sample__a1',source_commit:sha}};
 verification.execution_task_id=execution.id;
 verification.task_scope_sha256=hash(canonical({execution_task_id:execution.id,description:execution.description,payload:execution.payload}));
 verification.assertions.push({id:'task_scope',pass:true,evidence:['immutable://same-run/approved-filter']});
 const original=f.request;f.request=async path=>path==='/api/brain/tasks/'+taskId?task:path==='/api/brain/tasks/'+execution.id?execution:original(path);
 return {...f,task,execution,verification,args:{sha,targets:{'xian-m4':{definitions}},runIds:['sample__a1'],acceptanceTaskIds:{sample__a1:taskId},readFile:path=>{assert.equal(path,skillIdentity.path);return Buffer.from(skill);},request:f.request}};
}
for(const [label,change]of [
 ['缺独立报告',f=>delete f.args.acceptanceTaskIds],
 ['错误run',f=>f.verification.run_id='other'],
 ['错误源码SHA',f=>f.verification.source_commit='b'.repeat(40)],
 ['错误Skill摘要',f=>f.verification.skill.sha256='b'.repeat(64)],
 ['错误验收定义摘要',f=>f.verification.acceptance_definition_sha256='b'.repeat(64)],
 ['错误release',f=>f.task.result.workflow_control.envelope.definition.release_id='other'],
 ['错误binding',f=>f.verification.run_binding_id='other'],
 ['空断言',f=>f.verification.assertions=[]],
 ['部分断言',f=>f.verification.assertions.pop()],
 ['重复断言',f=>f.verification.assertions[1]=f.verification.assertions[0]],
 ['无逐项证据',f=>f.verification.assertions[0].evidence=[]],
 ['FAIL',f=>f.verification.verdict='FAIL'],
 ['unknown',f=>f.verification.assertions[0].pass='unknown'],
 ['partial',f=>f.verification.scope='partial'],
 ['未终态',f=>f.task.status='in_progress'],
 ['缺固定Skill源',f=>delete f.args.readFile],
 ['输入筛选改变',f=>f.execution.payload.acceptance.location='unlimited'],
 ['原执行任务未关联run',f=>delete f.execution.result.run_id],
 ['验收任务冒充执行任务',f=>f.verification.execution_task_id=f.task.id],
 ['缺任务范围断言',f=>f.verification.assertions.pop()],
 ['未覆盖全部Skill断言',f=>f.verification.assertions.splice(0,1)],
 ['未知Skill结构',f=>f.args.readFile=()=>Buffer.from('# 没有验收定义')],
])test('旧native pass必须拒绝完整Skill验收异常：'+label,async()=>{
 const f=fullSkillFixture();change(f);await assert.rejects(verifyBusinessAdmission(f.args),/独立|Skill/);
});
test('精确同run完整Skill独立终态报告可准入，实际GET而非调用方PASS',async()=>{
 const f=fullSkillFixture();const result=await verifyBusinessAdmission(f.args);
 assert.equal(result.runs[0].acceptance_task_id,f.task.id);
 assert.match(result.runs[0].acceptance_report_sha256,/^[a-f0-9]{64}$/);
});

test('输入摘要排除合法heartbeat/进度，原执行任务不允许换run',async()=>{
 const f=fullSkillFixture();Object.assign(f.execution,{driver_heartbeat_at:'later',status:'completed'});f.execution.payload.progress='later';
 assert.equal((await verifyBusinessAdmission(f.args)).runs[0].execution_task_id,f.execution.id);
 f.execution.result.run_id='another';await assert.rejects(verifyBusinessAdmission(f.args),/真实关联/);
});
test('规范章节必须完整，额外授权和接手要求进入冻结断言，来源链接不充数',async()=>{
 const {skillAcceptanceDefinition}=await import('../deployment-skill-acceptance.mjs');
 const {fixtureSkill}=await import('./fixtures/full-skill-acceptance.mjs');
 const base=fixtureSkill(102),extra='\n## 单Activity受控接手\n\n未触发需证据；已触发须原owner交接。\n\n## 复用已有Skill\n\n旧方法不能冒充本版完整成功。\n';
 const d=skillAcceptanceDefinition('douyin_video_processing',()=>Buffer.from(base+extra));
 assert.ok(d.checks.some(c=>c.section==='冻结来源绑定'));
 assert.ok(d.checks.some(c=>c.text==='未触发需证据；已触发须原owner交接。'));
 assert.ok(d.checks.some(c=>c.text==='旧方法不能冒充本版完整成功。'));
 for(const bad of [base.replace('## 执行','## 未知结构'),base.replace('## 冻结来源绑定\n\n保持原来源。',''),base.replace('2. 真实持久读回。','3. 真实持久读回。')])assert.throws(()=>skillAcceptanceDefinition('douyin_video_processing',()=>Buffer.from(bad)),/Skill/);
});

for(const [field,value]of [['send_authorized',true],['publication_authorized',true],['video_limit',3],['device_serial','other-device'],['line','other-company'],['candidate_sha','b'.repeat(40)],['workflow_key','douyin_lead_outreach']])test('真实b8请求字段变化令旧报告失效：'+field,async()=>{
 const f=fullSkillFixture();f.execution.payload={line:'jinuo',device_serial:'real-device',video_limit:2,send_authorized:false,publication_authorized:false,candidate_sha:sha,workflow_key:'douyin_video_processing'};
 // 此处只先取得旧实现会使用的摘要，证明改真实字段后仍放行的漏洞；修复后改用全部请求值。
 const {executionTaskScope}=await import('../deployment-skill-acceptance.mjs');
 const hash=x=>createHash('sha256').update(JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
 f.verification.task_scope_sha256=hash(executionTaskScope(f.execution));
 f.execution.payload[field]=value;
 await assert.rejects(verifyBusinessAdmission(f.args),/输入\/授权已变化/);
});

for(const status of ['in_progress','blocked','failed'])test('原执行任务'+status+'不能凭独立报告先行放行',async()=>{
 const f=fullSkillFixture();f.execution.status=status;await assert.rejects(verifyBusinessAdmission(f.args),/原执行任务/);
});
