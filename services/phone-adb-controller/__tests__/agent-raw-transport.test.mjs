import test from 'node:test';
import assert from 'node:assert/strict';
import * as definition from '../runtime-definition.mjs';

const env={LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',WFR_TAG:'raw103',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',LEADGEN_SOURCE_RUN:'raw102',WF_RUN_START_TS:'1700000000',WF_RUN_MAX_SECONDS:'1800'};
test('raw transport and finite turn quota become canonical frozen Agent input, with no fields added to legacy input',()=>{
 assert.equal(typeof definition.executionTransportInput,'function','raw mode needs an explicit validated freeze boundary');
 assert.equal(definition.executionTransportInput(env),null);
 const raw={...env,LEADGEN_EXECUTION_TRANSPORT:'raw-model-v1',LEADGEN_MAX_TURNS:'4'};
 assert.deepEqual(definition.executionTransportInput(raw),{execution_transport:'raw-model-v1',max_turns:4});
 assert.deepEqual(definition.agentInput(raw),{...definition.agentInput(env),execution_transport:'raw-model-v1',max_turns:4});
 for(const change of [{LEADGEN_MAX_TURNS:undefined},{LEADGEN_MAX_TURNS:'0'},{LEADGEN_MAX_TURNS:'65'},{LEADGEN_MAX_TURNS:'04'},{LEADGEN_EXECUTION_TRANSPORT:undefined},{LEADGEN_EXECUTION_TRANSPORT:'child'},{LEADGEN_EXECUTION_MODE:'code'},{WF_BRAIN_WORKFLOW:'douyin_lead_outreach'}]){
  const value={...raw,...change};for(const [key,item] of Object.entries(value))if(item===undefined)delete value[key];
  assert.throws(()=>definition.agentInput(value),/EXECUTION_(?:MODE|TRANSPORT)/);
 }
});

test('raw snapshot, Agent input and caller flags must agree exactly; no silently removed or increased turn budget',()=>{
 assert.equal(typeof definition.assertExecutionTransport,'function');
 const raw={...env,LEADGEN_EXECUTION_TRANSPORT:'raw-model-v1',LEADGEN_MAX_TURNS:'4'},input=definition.agentInput(raw);
 const snapshot={execution_mode:'agent',execution_transport:'raw-model-v1',max_turns:4,agent_input:input,workflow_version:{payload:{key:env.WF_BRAIN_WORKFLOW}}};
 assert.deepEqual(definition.assertExecutionTransport(snapshot,raw),{execution_transport:'raw-model-v1',max_turns:4});
 assert.deepEqual(definition.assertAgentInput(snapshot,raw),input);
 for(const value of [env,{...raw,LEADGEN_MAX_TURNS:'5'},{...raw,LEADGEN_EXECUTION_TRANSPORT:'child'}])assert.throws(()=>definition.assertAgentInput(snapshot,value),/EXECUTION_TRANSPORT/);
 for(const change of [{max_turns:5},{max_turns:undefined},{execution_transport:undefined},{execution_mode:undefined},{agent_input:{...input,max_turns:5}}]){
  const value={...snapshot,...change};for(const [key,item] of Object.entries(value))if(item===undefined)delete value[key];
  assert.throws(()=>definition.assertAgentInput(value,raw),/EXECUTION_TRANSPORT|AGENT_INPUT/);
 }
});
