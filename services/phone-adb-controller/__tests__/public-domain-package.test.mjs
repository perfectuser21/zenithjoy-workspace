import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,cpSync,readdirSync,readFileSync,writeFileSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {installPreflightPg,preflightPgLockIdentity} from '../preflight-pg-dependencies.mjs';
import {createWorkflowDomain} from '../leadgen-public-domain.mjs';
import {hash} from '../public-domain-snapshot.mjs';
const here=dirname(fileURLToPath(new URL('../leadgen-public-domain.mjs',import.meta.url)));
function inventory(root,prefix=''){return readdirSync(join(root,prefix),{withFileTypes:true}).flatMap(e=>{const p=prefix?prefix+'/'+e.name:e.name;return e.isDirectory()?inventory(root,p):e.isFile()?[p]:[];});}
test('real Code factory loads full fixed PG closure offline and preserves same-run internal binding without external ACK',async()=>{
 const temp=realpathSync(mkdtempSync(join(tmpdir(),'zj-domain-package-')));const source=join(temp,'source'),run=join(temp,'run');
 try{
  cpSync(here,source,{recursive:true,filter:p=>!p.includes('/__tests__')&&!p.includes('/node_modules')});
  // Build-time fetch is the existing pinned installer; factory/runtime perform no download.
  await installPreflightPg({runtimeRoot:source,sourceCommit:'a'.repeat(40)});
  const ids={workflow:randomUUID(),version:randomUUID(),ref:randomUUID(),activity:randomUUID(),av:randomUUID()};
  const profile={cwd:source,cleanup_required:false,resources:[],domain_adapter:{protocol:'workflow-domain/v1',entry:'leadgen-public-domain.mjs',export_name:'createWorkflowDomain',budget:{max_duration_s:60,cleanup_grace_s:30},config:{workflow_key:'douyin_comment_scoring',company:{company_id:randomUUID(),tenant_id:randomUUID(),version:26,policy_id:'original-v26'},resources:{machine:'mmv',profile:'mmv-scoring',serial:'none',line:'yuesheng',account:'none'},env:{P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_TAG:'test_public_103',LEADGEN_LIMIT:'1',LEADGEN_SOURCE_RUN:'original102'},step_spec:'plans/douyin_comment_scoring.steps.json',snapshot:{deployment:{source_commit:'a'.repeat(40),target:'mmv'},release:{id:randomUUID(),target:'mmv'},public_pg:preflightPgLockIdentity(),workflow_version:{id:ids.version,payload:{key:'douyin_comment_scoring',workflow_id:ids.workflow}},activities:[{reference:{slot_key:'scoring',reference_id:ids.ref,activity_id:ids.activity},version:{id:ids.av,payload:{contract:{budget:{max_duration_s:30}}}}}]}}},contract:{workflow:'douyin_comment_scoring',activities:[{key:'scoring',budget:{max_duration_s:30},runtime:{phase:'source'}}]},metadata:{scoring:{executor_kind:'code',activity_id:ids.activity}},files:Object.fromEntries(inventory(source).map(p=>[p,hash(readFileSync(join(source,p)))]))};
  const identity={run_id:randomUUID(),task_id:randomUUID(),machine_id:'mmv',mode:'formal',profile_sha256:hash(profile),input:{upstream:{run_id:randomUUID(),task_id:randomUUID(),run_directory:join(temp,'upstream'),profile_sha256:'e'.repeat(64)}},run_binding:{run_binding_id:randomUUID(),workflow_id:ids.workflow,workflow_definition_version_id:ids.version,attempt_key:'task:1',activities:{scoring:{reference_id:ids.ref,activity_id:ids.activity,activity_definition_version_id:ids.av}}}};
  const now=Date.now();const domain=await createWorkflowDomain({identity,profile,runDirectory:run,deadline_ms:now+60000,cleanup_deadline_ms:now+90000});
  assert.equal(typeof domain.executeActivity,'function');
  const frozen=JSON.parse(readFileSync(join(run,'run-definition.json')));assert.equal(frozen.public_domain.run_id,identity.run_id);assert.equal(frozen.public_domain.task_id,identity.task_id);assert.equal(frozen.run_identity.run_id,identity.run_id);
  assert.equal(inventory(run).some(p=>p.includes('run-bindings')||p.endsWith('.ack.json')),false);
  const authority=await import(pathToFileURL(join(run,'runtime','public-domain-authority.mjs')).href);
  const binding=await import(pathToFileURL(join(run,'runtime','runtime-binding.mjs')).href);
  assert.equal(binding.readBinding(run,'a1').run_id,identity.run_id);
  assert.equal(binding.readBinding(run,'a1').source_kind,'internal');
  const pg=await import(pathToFileURL(join(run,'runtime','public-domain-pg.mjs')).href);
  const env={...process.env,NODE_PATH:'',NODE_OPTIONS:'',NODE_PG_FORCE_NATIVE:'',WFR_RUN_DIR:run,WF_HOME:join(run,'runtime'),LEADGEN_EXECUTION_MODE:'code',WFR_RUN_ID:identity.run_id,WFR_ATTEMPT:'a1',WF_BRAIN_TASK_ID:identity.task_id,WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WFR_TAG:'test_public_103',LEADGEN_LINE:'yuesheng'};
  assert.throws(()=>pg.loadPublicDomainPg({runtimeRoot:join(run,'runtime'),input:{source:{commit:'a'.repeat(40)}},env:{...env,WF_BRAIN_TASK_ID:randomUUID()}}),/PUBLIC_DOMAIN_PG_SCOPE/);
  assert.throws(()=>pg.loadPublicDomainPg({runtimeRoot:join(run,'runtime'),input:{source:{commit:'b'.repeat(40)}},env}),/PUBLIC_DOMAIN_PG_SCOPE/);
  assert.throws(()=>pg.loadPublicDomainPg({runtimeRoot:join(run,'runtime'),input:{source:{commit:'a'.repeat(40)}},env:{...env,NODE_PATH:'/untrusted'}}),/PUBLIC_DOMAIN_PG_SCOPE/);
  const expected=profile.domain_adapter.config.company;
  const fixedRow={...expected,status:'enabled'};
  assert.equal((await pg.verifyPublicDomainCompany({runtimeRoot:join(run,'runtime'),env,pool:{query:async()=>({rows:[fixedRow]})}})).verified,true);
  await assert.rejects(pg.verifyPublicDomainCompany({runtimeRoot:join(run,'runtime'),env,pool:{query:async()=>({rows:[{...fixedRow,version:27}]})}}),/PUBLIC_DOMAIN_PG_SCOPE/);
  const realFetch=globalThis.fetch;
  const registered={id:identity.task_id,status:'in_progress',claimed_by:'common-runner',result:{common_runner:{run_id:identity.run_id,task_id:identity.task_id,machine_id:identity.machine_id,profile_sha256:identity.profile_sha256,run_binding:identity.run_binding}}};
  try{globalThis.fetch=async()=>({ok:true,json:async()=>registered});assert.equal((await pg.verifyPublicDomainTask({runtimeRoot:join(run,'runtime'),env:{...env,BRAIN_URL:'http://127.0.0.1:5221',BRAIN_INTERNAL_TOKEN:'unit-only'}})).claim_verified,true);
   globalThis.fetch=async()=>({ok:true,json:async()=>({...registered,claimed_by:'other-runner'})});await assert.rejects(pg.verifyPublicDomainTask({runtimeRoot:join(run,'runtime'),env:{...env,BRAIN_URL:'http://127.0.0.1:5221',BRAIN_INTERNAL_TOKEN:'unit-only'}}),/PUBLIC_DOMAIN_PG_SCOPE/);
  }finally{globalThis.fetch=realFetch;}
  const before=await domain.validateWorkflow(profile,{},{scope:'workflow',acceptance:{ref:'original-103'}});assert.equal(before.verdict,'fail','no business execution must never pass');
  const a=profile.contract.activities[0];const failed=await domain.executeActivity(a,{run_tag:identity.run_id,attempt:1},{});
  assert.equal(failed.status,'failed','missing original deployment manifest must fail before any business RPC');
  const checked=await domain.checkActivity(a,failed,{phase:'end',acceptance:{ref:'original-103'}});assert.equal(checked.verdict,'fail');
  assert.equal((await domain.close()).execution_stopped,true);
  assert.equal(authority.readPublicDomainBinding(run),null);
  assert.throws(()=>binding.readBinding(run,'a1'),/PUBLIC_DOMAIN_AUTHORITY_NOT_LIVE/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
