import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {preparePublicDomainSnapshot,hash} from '../public-domain-snapshot.mjs';

test('independent Codex snapshot declares its own host and pins Skill bytes without starting a workflow',()=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'direct-snapshot-'));
 try {
  writeFileSync(join(root,'steps.json'),'{}');writeFileSync(join(root,'SKILL.md'),'---\nname: example\n---\nExample');
  const av={reference_id:id(),activity_id:id(),activity_definition_version_id:id()},workflow=id(),version=id(),task=id();
  const skill={name:'example',version:'0.1.0',source_commit:'a'.repeat(40),path:'skill/SKILL.md',sha256:hash(readFileSync(join(root,'SKILL.md')))};
  const profile={cwd:root,files:{'steps.json':hash('{}')},metadata:{scoring:{activity_id:av.activity_id,executor_kind:'agent',runtime_snapshot_sha256:hash({'steps.json':hash('{}')})}},contract:{activities:[{key:'scoring'}]},domain_adapter:{budget:{max_duration_s:10,cleanup_grace_s:10},config:{primary_host:'codex-exec-v1',execution_mode:'agent',workflow_key:'douyin_comment_scoring',step_spec:'steps.json',company:{company_id:id(),tenant_id:id(),version:1,policy_id:'original'},resources:{machine:'us-mac-m4',profile:'mmv-scoring',serial:'none',line:'yuesheng',account:'none'},env:{P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_TAG:'direct103',LEADGEN_LIMIT:'1'},snapshot:{execution_mode:'agent',deployment:{source_commit:'b'.repeat(40),target:'mmv'},release:{id:id(),target:'mmv'},workflow_version:{id:version,payload:{workflow_id:workflow,key:'douyin_comment_scoring'}},activities:[{reference:{slot_key:'scoring',...av},version:{id:av.activity_definition_version_id}}]}}}};
  const identity={protocol:'codex-exec-v1',approved_keywords:[],mode:'formal',run_id:id(),task_id:task,task_run_id:id(),claimer:'codex-skill-direct',claimed_at:new Date().toISOString(),machine_id:'us-mac-m4',profile_sha256:hash(profile),skill,run_binding:{run_binding_id:id(),workflow_id:workflow,workflow_definition_version_id:version,attempt_key:task+':1',activities:{scoring:av}}};
  const out=preparePublicDomainSnapshot({identity,profile,runDirectory:join(root,'run'),deadline_ms:Date.now()+10000,cleanup_deadline_ms:Date.now()+20000,standaloneSkillPath:join(root,'SKILL.md')});
  assert.equal(out.snapshot.primary_host,'codex-exec-v1');
  assert.equal(out.snapshot.public_domain,undefined);
  assert.equal(out.snapshot.standalone_skill.task_id,task);
  assert.equal(out.snapshot.files[skill.path],skill.sha256);
  assert.equal(readFileSync(join(root,'run',skill.path),'utf8'),readFileSync(join(root,'SKILL.md'),'utf8'));
  assert.equal(out.snapshot.standalone_skill.scope_sha256,hash(out.snapshot.standalone_skill.scope));
  assert.equal(out.env.LEADGEN_EXECUTION_TRANSPORT,undefined);
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
