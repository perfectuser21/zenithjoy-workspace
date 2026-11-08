import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowDomain, validatePublicDomainIdentity, publicDomainRunId} from '../leadgen-public-domain.mjs';
import {randomUUID} from 'node:crypto';
const identity=()=>({run_id:randomUUID(),task_id:randomUUID(),mode:'formal',machine_id:'mmv',profile_sha256:'a'.repeat(64),run_binding:{run_binding_id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:randomUUID(),attempt_key:'task:1',activities:{preflight:{reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()}}}});
test('public domain keeps canonical internal run/task and rejects external/anonymous identities',()=>{
 const i=identity();assert.equal(validatePublicDomainIdentity(i).run_id,i.run_id);assert.equal(publicDomainRunId(i),i.run_id);
 for(const v of [{...i,mode:'exploration'},{...i,run_binding:undefined},{...i,run_id:'douyin_video_discovery-test__a1'},{...i,task_id:null},{...i,run_binding:{...i.run_binding,source_kind:'external'}}])assert.throws(()=>validatePublicDomainIdentity(v));
});
test('factory rejects 104 and never starts another runner/Commander',async()=>{
 await assert.rejects(createWorkflowDomain({identity:identity(),profile:{domain_adapter:{config:{workflow_key:'douyin_lead_outreach'}}},runDirectory:'/tmp/denied-public-domain'}),/PUBLIC_DOMAIN_WORKFLOW/);
});
test('factory fails before side effects on absent fixed deadlines',async()=>{
 await assert.rejects(createWorkflowDomain({identity:identity(),profile:{domain_adapter:{config:{workflow_key:'douyin_video_discovery'}}},runDirectory:'/tmp/denied-public-domain'}),/PUBLIC_DOMAIN_DEADLINE/);
});
