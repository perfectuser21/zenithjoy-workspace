import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {preparePublicDomainSnapshot,hash} from '../public-domain-snapshot.mjs';

test('103 从固定批次创建独立工具宿主并收尾，不获取手机锁',async()=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'direct-snapshot-'));
 try {
  writeFileSync(join(root,'steps.json'),'{}');writeFileSync(join(root,'SKILL.md'),'---\nname: example\n---\nExample');
  const av={reference_id:id(),activity_id:id(),activity_definition_version_id:id()},workflow=id(),version=id(),task=id();
  const skill={name:'example',version:'0.1.0',source_commit:'a'.repeat(40),path:'skill/SKILL.md',sha256:hash(readFileSync(join(root,'SKILL.md')))};
  const profile={cwd:root,files:{'steps.json':hash('{}')},metadata:{scoring:{activity_id:av.activity_id,executor_kind:'agent',runtime_snapshot_sha256:hash({'steps.json':hash('{}')})}},contract:{activities:[{key:'scoring'}]},domain_adapter:{budget:{max_duration_s:10,cleanup_grace_s:10},config:{primary_host:'codex-exec-v1',execution_mode:'agent',workflow_key:'douyin_comment_scoring',step_spec:'steps.json',company:{company_id:id(),tenant_id:id(),version:1,policy_id:'original'},resources:{machine:'us-mac-m4',profile:'mmv-scoring',serial:'none',line:'yuesheng',account:'none'},env:{P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_TAG:'direct103',LEADGEN_LIMIT:'1'},snapshot:{execution_mode:'agent',deployment:{source_commit:'b'.repeat(40),target:'mmv'},release:{id:id(),target:'mmv'},workflow_version:{id:version,payload:{workflow_id:workflow,key:'douyin_comment_scoring'}},activities:[{reference:{slot_key:'scoring',...av},version:{id:av.activity_definition_version_id}}]}}}};
  const identity={protocol:'codex-exec-v1',approved_keywords:[],mode:'formal',run_id:id(),task_id:task,task_run_id:id(),claimer:'codex-skill-direct',claimed_at:new Date().toISOString(),machine_id:'us-mac-m4',profile_sha256:hash(profile),skill,input:{source_run:'committed-source'},run_binding:{run_binding_id:id(),workflow_id:workflow,workflow_definition_version_id:version,attempt_key:task+':1',activities:{scoring:av}}};
  const out=preparePublicDomainSnapshot({identity,profile,runDirectory:join(root,'run'),deadline_ms:Date.now()+10000,cleanup_deadline_ms:Date.now()+20000,standaloneSkillPath:join(root,'SKILL.md')});
  assert.equal(out.snapshot.primary_host,'codex-exec-v1');
  assert.equal(out.snapshot.public_domain,undefined);
  assert.equal(out.snapshot.standalone_skill.task_id,task);
  assert.equal(out.snapshot.files[skill.path],skill.sha256);
  assert.equal(readFileSync(join(root,'run',skill.path),'utf8'),readFileSync(join(root,'SKILL.md'),'utf8'));
  assert.equal(out.snapshot.standalone_skill.scope_sha256,hash(out.snapshot.standalone_skill.scope));
  assert.equal(out.snapshot.standalone_skill.scope.source_run,'committed-source');
  assert.equal(out.env.LEADGEN_EXECUTION_TRANSPORT,undefined);
  const {startStandaloneSkillRuntime}=await import('../standalone-skill-runtime.mjs');
  writeFileSync(join(out.dir,'run-definition.json'),JSON.stringify({...out.snapshot,snapshot_sha256:hash(out.snapshot)}));
  const {standaloneAgentScoringContext}=await import('../public-domain-pg.mjs');
  const runtimeRoot=join(out.dir,'runtime');
  const scope=out.snapshot.standalone_skill.scope;
  const execution={run:scope.run_tag,run_id:identity.run_id,profile:scope.profile,line:scope.line};
  const request={op:'score_committed_scope',run:scope.run_tag,line:scope.line,source_run:null,limit:1,committed_origin_run:scope.source_run};
  const scoreContext=fields=>standaloneAgentScoringContext({runtimeRoot,input:{kind:'queue',source:{execution},request:{...request,...fields}}});
  assert.equal(scoreContext({}).agentScoreIdentity.task_id,task);
  assert.equal(scoreContext({}).agentScoreIdentity.run_id,identity.run_id);
  assert.throws(()=>scoreContext({committed_origin_run:'another-origin'}),/PUBLIC_DOMAIN_PG_SCOPE/);
  assert.throws(()=>scoreContext({op:'score_submit',sources:{[id()]:'another-origin'}}),/PUBLIC_DOMAIN_PG_SCOPE/);
  let call;
  const runtime=await startStandaloneSkillRuntime({runDirectory:out.dir,environment:out.env,dependencies:{
   hostRegistry:join(root,'registry'),bootstrap:async()=>true,leaseFactory:()=>assert.fail('103 不能领取手机'),
   rpcFactory:()=>()=>assert.fail('inspect 不执行判断或写业务'),
   ipcFactory:async options=>{call=options.call;return {connectionPath:'fixture',close:async()=>({ipc_closed:true})};},
  }});
  assert.deepEqual(await call('inspect',{}),{stage:'103',source_run:'committed-source',
   business_operations:['score_scope','score_input','score_submit','score_readback','mark_leads','mark_readback','bridge_outreach','bridge_readback']});
  assert.equal(await runtime.readEvidence(),null);
  assert.deepEqual(await runtime.close(),{task_id:task,run_id:identity.run_id,local_released:true,central_released:true,native_return_unknown:false});
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('Skill reference bytes are part of the frozen closure rather than a mutable external path',async()=>{
 const {freezeStandaloneSkillFiles}=await import('../public-domain-snapshot.mjs');
 const root=mkdtempSync(join(realpathSync(tmpdir()),'direct-skill-closure-'));
 try {
  const {mkdirSync}=await import('node:fs');mkdirSync(join(root,'source'));mkdirSync(join(root,'source','references'));mkdirSync(join(root,'run'));
  writeFileSync(join(root,'source','SKILL.md'),'[101](references/101.md)');writeFileSync(join(root,'source','references','101.md'),'原业务方法');
  const files={};freezeStandaloneSkillFiles({source:join(root,'source','SKILL.md'),runDirectory:join(root,'run'),files});
  assert.equal(files['skill/references/101.md'],hash('原业务方法'));
  assert.equal(readFileSync(join(root,'run','skill','references','101.md'),'utf8'),'原业务方法');
  writeFileSync(join(root,'source','references','101.md'),'外部修改');
  assert.equal(readFileSync(join(root,'run','skill','references','101.md'),'utf8'),'原业务方法');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('轻盈快照按已发布 Playbook 清单封存 Activity，不拾取未登记文件',async()=>{
 const {freezeStandaloneSkillFiles}=await import('../public-domain-snapshot.mjs');
 const {mkdirSync,writeFileSync,readFileSync}=await import('node:fs');
 const root=mkdtempSync(join(realpathSync(tmpdir()),'indexed-light-skill-'));
 try{
  const source=join(root,'source'), skills=join(root,'release','skills'), workflow='sample_workflow', name='sample-preflight';
  mkdirSync(join(source,'references'),{recursive:true}); writeFileSync(join(source,'SKILL.md'),'入口接线说明');
  writeFileSync(join(source,'references','102.md'),'原简化说明');
  const playbook=join(skills,'sample-playbook'), method=join(skills,name);
  mkdirSync(join(playbook,'references'),{recursive:true});mkdirSync(method);
  writeFileSync(join(playbook,'SKILL.md'),'使用 [预检](../sample-preflight/SKILL.md)');
  const index={workflow_key:workflow,activities:[{activity_ref:workflow+'.preflight',skill_name:name,
    skill_path:'services/phone-adb-controller/skills/'+name+'/SKILL.md',skill_version:'1.0.0'}]};
  writeFileSync(join(playbook,'references','activity-methods.json'),JSON.stringify(index));
  const content='---\nname: sample-preflight\nmetadata:\n  version: 1.0.0\n  activity_ref: sample_workflow.preflight\n  method_role: single-activity\n---\n真实预检方法';
  writeFileSync(join(method,'SKILL.md'),content);
  mkdirSync(join(skills,'extra'));writeFileSync(join(skills,'extra','SKILL.md'),'不得加载');
  const files={};const result=freezeStandaloneSkillFiles({source:join(source,'SKILL.md'),runDirectory:join(root,'run'),files,activitySkills:{root:skills,workflowKey:workflow,entryReference:'references/102.md'}});
  const entry=readFileSync(join(root,'run','skill','references','102.md'),'utf8');
  assert.match(entry,/\.\.\/workflow\/sample-playbook\/SKILL.md/);
  assert.equal(files['skill/references/102.md'],hash(entry));
  assert.doesNotMatch(entry,/原简化说明/);
  assert.equal(result.playbook,'skill/workflow/sample-playbook/SKILL.md');
  assert.deepEqual(result.activities.map(x=>[x.activity_ref,x.path]),[[workflow+'.preflight','skill/workflow/sample-preflight/SKILL.md']]);
  assert.equal(files['skill/workflow/sample-preflight/SKILL.md'],hash(content));
  assert.ok(!Object.keys(files).some(name=>name.includes('/extra/')));
  assert.equal(readFileSync(join(root,'run',result.playbook),'utf8'),'使用 [预检](../sample-preflight/SKILL.md)');
  writeFileSync(join(method,'SKILL.md'),content.replace('version: 1.0.0','version: 1.0.1'));
  assert.throws(()=>freezeStandaloneSkillFiles({source:join(source,'SKILL.md'),runDirectory:join(root,'bad'),files:{},activitySkills:{root:skills,workflowKey:workflow}}),/ACTIVITY_SKILL_VERSION/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
