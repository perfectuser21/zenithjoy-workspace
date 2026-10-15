import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySkillRequest} from '../leadgen-skill-agent.mjs';
const q={run_id:'fixture__a1',binding_id:'binding1',source_commit:'a'.repeat(40),workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'s1',activity_key:'scoring',broker_host:'mmv',deadline_ms:Date.now()+10000,mode:'repair',method:{reference_id:'ref1',activity_version_id:'av1',name:'method1',version:'0.2.0',sha256:'x',text:'method bytes',support:{sha256:'y',text:'policy'}}};
const binding={id:'binding1',run_id:q.run_id,workflow_id:'w1',workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'s1',external_origin:'zenithjoy:mmv'};
const wf={source_commit:q.source_commit,payload:{activities:[{slot_key:'scoring',reference_id:'ref1',activity_id:'a1',activity_version_id:'av1'}]}};
const av={payload:{contract:{budget:{max_duration_s:30}},implementation_bindings:[{kind:'skill',name:'method1',version:'0.2.0',content_sha256:'x',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)}]}};
const get=async path=>path.includes('/runs/')?{binding}:path.includes('/workflows/')?{version:wf}:{version:av};
test('real central binding/Workflow/Activity identity is required before Skill launch',async()=>{
 assert.equal(await verifySkillRequest(q,{get,verifyMethod:()=>true}),true);
 for(const mutation of [{binding_id:'other'},{release_id:'other'},{source_commit:'b'.repeat(40)},{broker_host:'xian-m4'},{activity_key:'send_dm'},{method:{...q.method,activity_version_id:'other'}},{runtime_snapshot_sha256:'other'}])await assert.rejects(()=>verifySkillRequest({...q,...mutation},{get,verifyMethod:()=>true}));
});

test('unverified or wrong-revision Skill reference cannot authorize a child',async()=>{
 const binding=av.payload.implementation_bindings[0];
 for(const mutation of [{status:'unknown'},{revision:'c'.repeat(40)},{repo:'other/repo'}]){const original={...binding};Object.assign(binding,mutation);try{await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}));}finally{Object.assign(binding,original);}}
});
