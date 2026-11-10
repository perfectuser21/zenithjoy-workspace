import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync,cpSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {registerPublicDomainAuthority,readPublicDomainBinding} from '../public-domain-authority.mjs';
import {preparePublicDomainSnapshot,hash} from '../public-domain-snapshot.mjs';
import * as leases from '../native-task-lease.mjs';
const id=()=>randomUUID();
function fixture(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'public-primary-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const ref={reference_id:id(),activity_id:id(),activity_definition_version_id:id()},workflow_id=id(),workflow_definition_version_id=id();
 const identity={run_id:id(),task_id:id(),machine_id:'us-mac-m4',mode:'formal',profile_sha256:'a'.repeat(64),run_binding:{run_binding_id:id(),workflow_id,workflow_definition_version_id,attempt_key:'task:1',activities:{scoring:ref}}};
 const claim={claimed_by:'common-runner',claimed_at:'2026-11-09T00:00:00.000Z'};
 const task={id:identity.task_id,status:'in_progress',...claim,result:{common_runner:{...identity,run_binding:identity.run_binding}}};
 const deadline=Date.now()+10000,cleanup=Date.now()+20000;
 const frozen={execution_mode:'agent',snapshot_sha256:'b'.repeat(64),agent_input:{workflow_key:'douyin_comment_scoring',task_id:identity.task_id,run_tag:'first103',profile:'mmv-scoring',serial:'none'},native_claim:claim,public_domain:identity,deployment:{source_commit:'c'.repeat(40)},workflow_version:{id:workflow_definition_version_id,payload:{workflow_id}}};
 return {root,identity,claim,task,deadline,cleanup,frozen};
}
test('public primary lease needs actual heartbeat plus same live internal Task and revokes with parent authority',async t=>{
 const f=fixture(t);let posts=0;const server=http.createServer(async(req,res)=>{for await(const c of req){};if(req.method==='GET')return res.end(JSON.stringify(f.task));posts++;res.end(JSON.stringify({ok:true,lease_until:new Date(Date.now()+30000).toISOString(),lease_seconds:30,heartbeat_count:1}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const env={BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'unit-only'};
 assert.equal(typeof leases.issuePublicNativeTaskLease,'function');
 await assert.rejects(leases.issuePublicNativeTaskLease({runDir:f.root,frozen:f.frozen,env}),/PUBLIC_AUTHORITY/);assert.equal(posts,0);
 const stop=registerPublicDomainAuthority({runDirectory:f.root,identity:f.identity,deadline_ms:f.deadline,cleanup_deadline_ms:f.cleanup});t.after(stop);
 await leases.issuePublicNativeTaskLease({runDir:f.root,frozen:f.frozen,env});assert.equal(posts,1);
 const binding=readPublicDomainBinding(f.root);assert.equal(leases.assertFrozenNativeTaskLease(f.frozen).reply.ok,true);
 assert.equal(leases.assertNativeTaskAssociation({frozen:f.frozen,binding,taskId:f.identity.task_id,runDir:f.root,scope:{task_id:f.identity.task_id,run_id:f.identity.run_id,source_commit:f.frozen.deployment.source_commit,profile:'mmv-scoring',serial:'none'}}).kind,'verified_public_native_task_association');
 assert.throws(()=>leases.assertFrozenNativeTaskLease({...f.frozen,snapshot_sha256:'d'.repeat(64)}),/PUBLIC_AUTHORITY/);
 stop();assert.throws(()=>leases.assertFrozenNativeTaskLease(f.frozen),/PUBLIC_AUTHORITY/);
});
test('public primary snapshot preserves raw transport and sets mode agent without retaining another Task input',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'steps.json'),'{}');
 const av=f.identity.run_binding.activities.scoring;
 const profile={cwd:f.root,files:{'steps.json':hash('{}')},metadata:{scoring:{activity_id:av.activity_id,executor_kind:'agent',runtime_snapshot_sha256:'e'.repeat(64)}},contract:{activities:[{key:'scoring'}]},domain_adapter:{budget:{max_duration_s:10,cleanup_grace_s:10},config:{execution_mode:'agent',workflow_key:'douyin_comment_scoring',step_spec:'steps.json',company:{company_id:id(),tenant_id:id(),version:26,policy_id:'original'},resources:{machine:'us-mac-m4',profile:'mmv-scoring',serial:'none',line:'yuesheng',account:'none'},env:{P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_TAG:'first103',LEADGEN_LIMIT:'5'},snapshot:{execution_mode:'agent',execution_transport:'raw-model-v1',max_turns:12,agent_input:{task_id:id()},native_task_lease:{untrusted:true},deployment:{source_commit:'c'.repeat(40),target:'mmv'},release:{id:id(),target:'mmv'},workflow_version:f.frozen.workflow_version,activities:[{reference:{slot_key:'scoring',...av},version:{id:av.activity_definition_version_id}}]}}}};
 profile.domain_adapter.config.snapshot.workflow_version.payload.key='douyin_comment_scoring';
 const identity={...f.identity,profile_sha256:hash(profile)},out=preparePublicDomainSnapshot({identity,profile,runDirectory:join(f.root,'run'),deadline_ms:f.deadline,cleanup_deadline_ms:f.cleanup});
 assert.equal(out.env.LEADGEN_EXECUTION_MODE,'agent');assert.equal(out.env.LEADGEN_EXECUTION_TRANSPORT,'raw-model-v1');assert.equal(out.snapshot.execution_mode,'agent');assert.equal(out.snapshot.agent_input,undefined);assert.equal(out.snapshot.native_task_lease,undefined);assert.equal(out.snapshot.public_domain.run_id,identity.run_id);assert.equal(out.snapshot.public_domain.runtime_snapshot_sha256,'e'.repeat(64));
 const child=structuredClone(profile);child.domain_adapter.config.primary_host='official-child-v1';delete child.domain_adapter.config.snapshot.execution_transport;delete child.domain_adapter.config.snapshot.max_turns;
 const childOut=preparePublicDomainSnapshot({identity:{...identity,profile_sha256:hash(child)},profile:child,runDirectory:join(f.root,'child-run'),deadline_ms:f.deadline,cleanup_deadline_ms:f.cleanup});
 assert.equal(childOut.snapshot.primary_host,'official-child-v1');assert.equal(childOut.snapshot.execution_transport,undefined);assert.equal(childOut.env.LEADGEN_EXECUTION_TRANSPORT,undefined);
});

// Full product factory + createWorkflowExecution + primary executor are real.
// Only unavailable native/model effects are replaced by a refusing native provider.
for(const variant of ['raw','close-failure','real-tools'])test(variant==='real-tools'?'public factory uses real 103 tools and preserves an uncertain scoring commit':variant==='close-failure'?'public factory never upgrades a failed primitive close on repeated close':'real public factory routes an unsupported first Skill through executeAgent and never executes Code business',async t=>{
 const closeFailure=variant==='close-failure',realTools=variant==='real-tools';
 const f=fixture(t),source=join(f.root,'source'),run=join(f.root,'run');
 const controller=fileURLToPath(new URL('../',import.meta.url));
 cpSync(controller,source,{recursive:true,filter:p=>!p.includes('/__tests__')&&!p.includes('/node_modules')});
 writeFileSync(join(source,'native-scoring-workflow.mjs'),`export const isNativeScoringWorkflow=v=>v?.brand===true;
 export const createNativeScoringWorkflow=()=>({brand:true,prepare:async()=>{},supports:()=>false,nativeState:()=>({execution_unknown:false}),snapshot:()=>({prepared:true})});`);
 writeFileSync(join(source,'native-scoring-control.mjs'),`export const freezeScoringControlScope=()=>({fixture:true});`);
 const workflow=join(source,'leadgen-workflow.mjs');writeFileSync(workflow,readFileSync(workflow,'utf8').replace('export async function invokeNativeActivity(execute,state){',"export async function invokeNativeActivity(execute,state){throw Error('CODE_BUSINESS_FORBIDDEN');\n"));
 const {installPreflightPg,preflightPgLockIdentity}=await import('../preflight-pg-dependencies.mjs');await installPreflightPg({runtimeRoot:source,sourceCommit:f.frozen.deployment.source_commit});
 const inventory=(root,p='')=>readdirSync(join(root,p),{withFileTypes:true}).flatMap(e=>{const n=p?p+'/'+e.name:e.name;return e.isDirectory()?inventory(root,n):e.isFile()?[n]:[];});
 const av=f.identity.run_binding.activities.scoring,c={key:'scoring',budget:{max_duration_s:30,heartbeat_s:5},runtime:{phase:'source'}};
 const snapshot={execution_mode:'agent',execution_transport:'raw-model-v1',max_turns:12,deployment:{source_commit:f.frozen.deployment.source_commit,target:'mmv'},release:{id:id(),target:'mmv'},public_pg:preflightPgLockIdentity(),workflow_version:{id:f.identity.run_binding.workflow_definition_version_id,payload:{workflow_id:f.identity.run_binding.workflow_id,key:'douyin_comment_scoring'}},activities:[{reference:{slot_key:'scoring',...av},version:{id:av.activity_definition_version_id,payload:{contract:c}}}]};
 const profile={cwd:source,files:Object.fromEntries(inventory(source).map(n=>[n,hash(readFileSync(join(source,n)))])),metadata:{scoring:{activity_id:av.activity_id,executor_kind:'agent',runtime_snapshot_sha256:'e'.repeat(64)}},contract:{activities:[c]},domain_adapter:{budget:{max_duration_s:30,cleanup_grace_s:10},config:{execution_mode:'agent',workflow_key:'douyin_comment_scoring',step_spec:'plans/douyin_comment_scoring.steps.json',snapshot,resources:{machine:'us-mac-m4',profile:'mmv-scoring',serial:'none',line:'yuesheng',account:'none'},company:{company_id:id(),tenant_id:id(),version:26,policy_id:'original'},env:{P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',WFR_TAG:'first103',LEADGEN_LIMIT:'5'}}}};
 if(closeFailure){
  writeFileSync(join(source,'official-child-primitives.mjs'),`export const officialChildOperationReturned=()=>false;export const officialChildInvocationNotStarted=()=>false;export const createOfficialChildPrimitives=()=>({supports:()=>false,snapshot:()=>({}),quarantine:async()=>({verified:false,physical_actions:0}),close:async()=>({execution_stopped:false})});`);
  profile.domain_adapter.config.primary_host='official-child-v1';delete snapshot.execution_transport;delete snapshot.max_turns;snapshot.primary_host='official-child-v1';
  profile.files=Object.fromEntries(inventory(source).map(n=>[n,hash(readFileSync(join(source,n)))]));
 }
 if(realTools){
  const methodName='douyin-leadgen-activity-103-scoring',text=readFileSync(join(source,'skills',methodName,'SKILL.md'),'utf8');
  snapshot.activities[0].version.payload.definition_key='douyin_comment_scoring.scoring';snapshot.activities[0].version.payload.implementation_bindings=[{kind:'skill',name:methodName,version:text.match(/^  version: (\S+)/m)[1],path:'services/phone-adb-controller/skills/'+methodName+'/SKILL.md'}];
  const client=join(source,'leadgen-client.mjs');writeFileSync(client,readFileSync(client,'utf8').replace('export function createRpc(','function unusedFixtureRpc(')+`
export function createRpc({environment:env}){return async q=>{const fs=await import('node:fs'),path=await import('node:path');fs.appendFileSync(path.join(env.WFR_RUN_DIR,'fixture-rpc.jsonl'),JSON.stringify(q)+'\\n');const company=JSON.parse(fs.readFileSync(path.join(env.WF_HOME,'fixture-company.json')));if(q.kind==='queue'&&q.request.op==='company_config')return {ok:true,result:company};if(q.kind==='queue'&&q.request.op==='score_scope')return {ok:true,result:{ids:['11111111-1111-4111-8111-111111111111'],sources:{'11111111-1111-4111-8111-111111111111':'fixture102'}}};if(q.kind==='queue'&&q.request.op==='score')throw Error('FIXTURE_SCORE_ACK_LOST');throw Error('FIXTURE_RPC_UNEXPECTED');};}
`);
  writeFileSync(join(source,'official-child-host.mjs'),`import {callActivityTool} from './activity-skill-tool.mjs';import {writeFileSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';export const createPublicOfficialChildRpc=({runDir})=>async q=>{if(q.kind==='activity_skill_authority')return {authorized:true};if(q.kind==='activity_skill_stop')return {result:{execution_stopped:false}};const r=q.request,context=(await callActivityTool(r.broker_request_path,'inspect')).result;writeFileSync(join(runDir,'fixture-real-tools.json'),JSON.stringify(context));await callActivityTool(r.broker_request_path,'business',{operation:'score_scope',input:{}});for(let i=0;i<2;i++)try{await callActivityTool(r.broker_request_path,'business',{operation:'score',input:{ids:['11111111-1111-4111-8111-111111111111']}});}catch{}const child=randomUUID();return {result:{status:'ok',source_commit:r.source_commit,execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,child_run_id:child,terminal:{runId:child,status:'ok',endedAt:Date.now()}}};};`);
  writeFileSync(join(source,'fixture-company.json'),JSON.stringify(profile.domain_adapter.config.company));
  profile.domain_adapter.config.primary_host='official-child-v1';delete snapshot.execution_transport;delete snapshot.max_turns;snapshot.primary_host='official-child-v1';
  profile.files=Object.fromEntries(inventory(source).map(n=>[n,hash(readFileSync(join(source,n)))]));
 }
 const identity={...f.identity,profile_sha256:hash(profile)};f.task.result.common_runner={...identity};
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const seconds=raw?JSON.parse(raw).lease_seconds:30;res.end(JSON.stringify(req.method==='GET'?f.task:{ok:true,lease_until:new Date(Date.now()+seconds*1000).toISOString(),lease_seconds:seconds,heartbeat_count:1}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const prior={BRAIN_URL:process.env.BRAIN_URL,BRAIN_INTERNAL_TOKEN:process.env.BRAIN_INTERNAL_TOKEN};process.env.BRAIN_URL='http://127.0.0.1:'+server.address().port;process.env.BRAIN_INTERNAL_TOKEN='unit-only';t.after(()=>{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const {createWorkflowDomain}=await import('../leadgen-public-domain.mjs');
 const now=Date.now(),domain=await createWorkflowDomain({identity,profile,runDirectory:run,deadline_ms:now+30000,cleanup_deadline_ms:now+40000});
 if(closeFailure){assert.equal((await domain.close()).execution_stopped,false);assert.equal((await domain.close()).execution_stopped,false);return;}
 const result=await domain.executeActivity(c,{run_tag:identity.run_id,attempt:1});
 if(realTools){assert.equal(result.adapter_result.error_code,undefined,JSON.stringify(result.adapter_result));const context=JSON.parse(readFileSync(join(run,'fixture-real-tools.json')));assert.deepEqual(context.phone_capabilities,[]);assert.equal(context.scope.run_id,identity.run_id);assert.equal(context.scope.source_run,null);const calls=readFileSync(join(run,'fixture-rpc.jsonl'),'utf8').trim().split('\n').map(v=>JSON.parse(v));assert.equal(calls.filter(q=>q.request?.op==='score').length,1);assert.equal(result.adapter_result.execution_stopped,false);assert.equal((await domain.close()).execution_stopped,false);assert.equal((await domain.close()).execution_stopped,false);await assert.rejects(domain.executeActivity(c,{run_tag:identity.run_id,attempt:2}));return;}
 assert.equal(result.adapter_result.reason,'AGENT_PRIMARY_NATIVE_DOMAIN_UNSUPPORTED');assert.equal(result.adapter_result.not_started,true);assert.equal(result.adapter_result.execution_stopped,true);assert.equal(result.status,'needs_review');assert.equal(existsSync(join(run,'skill-handoff')),false);assert.equal((await domain.close()).execution_stopped,true);
});

test('new public raw host rejects a fenced schema2 scope before snapshot writes, leases or phone actions',t=>{
 const f=fixture(t),run=join(f.root,'never-created');
 const profile={domain_adapter:{config:{primary_host:'raw-model-v1',snapshot:{deployment:{source_commit:'c'.repeat(40)},release:{id:id()},workflow_version:{id:id()},activities:[],discovery_phone_scope:{policy:{schema_version:2}}},step_spec:'steps.json'}}};
 assert.throws(()=>preparePublicDomainSnapshot({identity:f.identity,profile,runDirectory:run,deadline_ms:f.deadline,cleanup_deadline_ms:f.cleanup}),/PUBLIC_DOMAIN_RAW_EPOCH_UNSUPPORTED/);assert.equal(existsSync(run),false);
});

test('official child independently reads original business facts without borrowing a raw native judge domain',async()=>{
 const {readbackActivityChecks}=await import('../leadgen-workflow.mjs');let readback;
 const args={executionMode:'agent',activity:{key:'scoring'},frozen:{primary_host:'official-child-v1'},env:{WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WFR_TAG:'original103',LEADGEN_LINE:'yuesheng'},metrics:{scored:5},rpc:async q=>{readback=q;return {result:{probes:[{pass:true}]}};}};
 const result=await readbackActivityChecks(args);assert.equal(readback.kind,'verify');assert.equal(readback.stage,'scoring');assert.equal(result.result.probes[0].pass,true);
 await assert.rejects(readbackActivityChecks({...args,frozen:{execution_transport:'raw-model-v1'}}),/NATIVE_103_JUDGE_DOMAIN_UNSUPPORTED/);
});
