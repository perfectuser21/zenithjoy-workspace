import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startPrimaryActivityBroker} from '../activity-skill-primary-broker.mjs';

const module=await import('../activity-skill-broker-client.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};
 throw error;
});
async function fixture(t,{onEvent=async()=>({action:'none'}),authorize=async()=>true}={}){
 const directory=mkdtempSync(join(tmpdir(),'parent-broker-client-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const request={protocol:'leadgen-activity-v1',mode:'execute',run_id:'parent-loop-fixture',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',activity_key:'preflight',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),runtime_snapshot_sha256:'c'.repeat(64),deadline_ms:Date.now()+10000,broker_request_path:join(directory,'broker-request.json')};
 const effects=[];
 const broker=await startPrimaryActivityBroker({directory,request,inspect:async()=>({phone_capabilities:['account-current'],business_capabilities:['lookup'],pending_write_readbacks:[]}),phone:async command=>{effects.push(command);return {observed:true};},business:async(operation,input)=>{effects.push({operation,input});return {durable_id:'server-owned'};},getActivityResult:()=>({durable_id:'server-owned'}),authorize,onEvent,onAbort:async()=>({execution_stopped:true})});
 t.after(()=>broker.close());
 assert.equal(typeof module.createActivitySkillBrokerClient,'function','parent Code needs a direct, bound broker client');
 const client=module.createActivitySkillBrokerClient({request,requestPath:broker.requestPath,authorize});
 return {directory,request,broker,client,effects};
}

test('parent Code sends real broker operations and receives Commander correction on its next inspection',async t=>{
 const {client,broker,effects,directory}=await fixture(t,{onEvent:async event=>event.operation==='business'?{action:'steer',text:'Use the original account rule.'}:{action:'none'}});
 assert.deepEqual(await client.call('business',{operation:'lookup',input:{video_id:'123'}}),{ok:true,result:{durable_id:'server-owned'}});
 const next=await client.call('inspect');
 assert.deepEqual(next.result.commander_guidance,['Use the original account rule.']);
 assert.deepEqual(effects,[{operation:'lookup',input:{video_id:'123'}}]);
 const events=readFileSync(join(directory,'broker-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events[0].commander_action.action,'steer');
 assert.equal(broker.getResult().result.durable_id,'server-owned');
 assert.equal(client.snapshot().execution_unknown,false);
});

test('caller JSON cannot override scope, choose resume or bypass original broker phone validation',async t=>{
 const {client,effects}=await fixture(t);
 await assert.rejects(client.call('inspect',{nonce:'forged'}),/PARENT_BROKER_INPUT_INVALID/);
 await assert.rejects(client.call('resume',{}),/PARENT_BROKER_OPERATION_NOT_ALLOWED/);
 await assert.rejects(client.call('phone',{command:'account-current',args:['x\ny']}),/SKILL_PRIMARY_PHONE_INPUT_INVALID/);
 assert.deepEqual(effects,[]);
});

test('seal revokes an operation whose official authorization has not returned',async t=>{
 let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const {client,effects}=await fixture(t,{authorize:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 const pending=client.call('phone',{command:'account-current',args:[]});
 await started;client.seal();release(true);
 await assert.rejects(pending,/PARENT_BROKER_SEALED/);
 assert.deepEqual(effects,[]);
 await assert.rejects(client.call('inspect'),/PARENT_BROKER_SEALED/);
});

test('parent direct relay requires official Code authorization before any tool delivery',async t=>{
 const {client,effects}=await fixture(t,{authorize:async()=>false});
 await assert.rejects(client.call('business',{operation:'lookup',input:{}}),/PARENT_BROKER_UNAUTHORIZED/);
 assert.deepEqual(effects,[]);
 assert.equal(client.snapshot().execution_unknown,false);
});

test('Commander abort is visible through the original inspection and prevents a subsequent business effect',async t=>{
 const {client,effects}=await fixture(t,{onEvent:async event=>event.type==='question'?{action:'abort',reason:'Original account mismatch'}:{action:'none'}});
 await client.call('inspect',{question:'Which account is allowed?'});
 assert.equal((await client.call('inspect')).result.commander_abort,true);
 await assert.rejects(client.call('business',{operation:'lookup',input:{}}),/SKILL_PRIMARY_EXECUTION_BLOCKED/);
 assert.deepEqual(effects,[]);
});
