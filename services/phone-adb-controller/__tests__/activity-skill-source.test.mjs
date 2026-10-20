import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySkillRequest} from '../leadgen-skill-agent.mjs';
const q={run_id:'fixture__a1',binding_id:'binding1',source_commit:'a'.repeat(40),workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'s1',activity_key:'scoring',broker_host:'mmv',deadline_ms:Date.now()+10000,mode:'repair',method:{reference_id:'ref1',activity_version_id:'av1',name:'method1',version:'0.2.0',sha256:'x',text:'method bytes',support:{sha256:'y',text:'policy'}}};
const binding={id:'binding1',run_id:q.run_id,workflow_id:'w1',workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'s1',external_origin:'zenithjoy:mmv'};
const wf={source_commit:q.source_commit,payload:{activities:[{slot_key:'scoring',reference_id:'ref1',activity_id:'a1',activity_version_id:'av1'}]}};
const av={payload:{contract:{budget:{max_duration_s:30}},implementation_bindings:[{kind:'skill',name:'method1',version:'0.2.0',content_sha256:'x',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)}]}};
av.payload.definition_key='douyin_comment_scoring.scoring';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=x=>createHash('sha256').update(canonical(x)).digest('hex');
const receipt=()=>({activity_version_id:'av1',definition_key:av.payload.definition_key,sha256:sha(av.payload.contract),payload:structuredClone(av.payload.contract)});
q.method.contract=receipt();av.contract_sha256=sha(av.payload.contract);
const get=async path=>path.includes('/runs/')?{binding}:path.includes('/workflows/')?{version:wf}:{version:av};
test('real central binding/Workflow/Activity identity is required before Skill launch',async()=>{
 assert.equal(await verifySkillRequest(q,{get,verifyMethod:()=>true}),true);
 for(const mutation of [{binding_id:'other'},{release_id:'other'},{source_commit:'b'.repeat(40)},{broker_host:'xian-m4'},{activity_key:'send_dm'},{method:{...q.method,activity_version_id:'other'}},{runtime_snapshot_sha256:'other'}])await assert.rejects(()=>verifySkillRequest({...q,...mutation},{get,verifyMethod:()=>true}));
});

test('unverified or wrong-revision Skill reference cannot authorize a child',async()=>{
 const binding=av.payload.implementation_bindings[0];
 for(const mutation of [{status:'unknown'},{revision:'c'.repeat(40)},{repo:'other/repo'}]){const original={...binding};Object.assign(binding,mutation);try{await assert.rejects(()=>verifySkillRequest(q,{get,verifyMethod:()=>true}));}finally{Object.assign(binding,original);}}
});

test('central frozen Activity opt-in is mandatory and cannot be raised by the transport request',async()=>{
 for(const policy of [undefined,{}, {max_additional_turns:2},{max_additional_turns:1,other:true},{max_additional_turns:'1'}]){
  av.payload.contract.agent_recovery=policy;
  try{await assert.rejects(()=>verifySkillRequest({...q,transport_generation:0},{get,verifyMethod:()=>true}),/RECOVERY_POLICY_UNVERIFIED/);}finally{delete av.payload.contract.agent_recovery;}
 }
 av.payload.contract.agent_recovery={max_additional_turns:1};
 try{av.contract_sha256=sha(av.payload.contract);assert.equal(await verifySkillRequest({...q,method:{...q.method,contract:receipt()},transport_generation:0},{get,verifyMethod:()=>true}),true);}finally{delete av.payload.contract.agent_recovery;}
});

test('只读冻结合同必须与权威AV正文和摘要全等，不能自签或换版本',async()=>{
 av.contract_sha256=sha(av.payload.contract);const good={...q,method:{...q.method,contract:receipt()}};
 assert.equal(await verifySkillRequest(good,{get,verifyMethod:()=>true}),true);
 const forged={...receipt(),payload:{...av.payload.contract,budget:{max_duration_s:3600}}};forged.sha256=sha(forged.payload);
 for(const value of [undefined,forged,{...receipt(),activity_version_id:'other-av'},{...receipt(),definition_key:'other.slot'},{...receipt(),sha256:'0'.repeat(64)}]){
  await assert.rejects(()=>verifySkillRequest({...good,method:{...good.method,contract:value}},{get,verifyMethod:()=>true}),/RPC_SKILL_ACTIVITY_CONTRACT_MISMATCH/);
 }
});
