import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
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
});
