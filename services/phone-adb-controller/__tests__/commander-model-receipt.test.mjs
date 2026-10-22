import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClawCommander} from '../activity-commander.mjs';
const scope={workflow_key:'douyin_video_discovery',run_id:'douyin_video_discovery-proof__a1',binding_id:'binding-proof',task_id:null,source_commit:'a'.repeat(40),activity:'collect_videos',phase:'before'};
function raw(overrides={}){return {status:'ok',runId:'official-run',result:{payloads:[{text:JSON.stringify({action:'continue',reason:'实际回执'})}],meta:{agentMeta:{provider:'openai',model:'gpt-6.1-sol',sessionId:'official-session',assistantTurns:2,terminalReceipt:{runId:'official-run',sessionId:'official-session',turnId:'official-turn',effective:{provider:'openai',model:'gpt-6.1-sol',responseModel:'gpt-6.1-sol'}},...overrides}}}};}
function home(t){const p=mkdtempSync(join(tmpdir(),'commander-model-proof-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('正式Commander保存供应商元数据和官方运行链，不将官方turn冒response_id',async t=>{
 const output=JSON.stringify(raw());const decision=await openClawCommander({home:home(t),execute:async()=>({stdout:output})})(scope);
 assert.equal(decision.model_receipt.provider,'openai');assert.equal(decision.model_receipt.model,'gpt-6.1-sol');assert.equal(decision.model_receipt.response_id,null);assert.equal(decision.model_receipt.response_id_reason,'provider_not_exposed');
 assert.equal(decision.model_receipt.openclaw.run_id,'official-run');assert.equal(decision.model_receipt.openclaw.turn_id,'official-turn');assert.equal(decision.model_receipt.assistant_turns,2);assert.equal(decision.model_receipt.provider_call_count,null);assert.equal(decision.model_receipt.raw_response,output);
 const {verifyCommanderModelReceipt}=await import('../commander-model-receipt.mjs');assert.equal(verifyCommanderModelReceipt(decision.model_receipt,scope),true);
 for(const [key,value] of [['run_id','foreign'],['source_commit','b'.repeat(40)],['activity','cleanup'],['phase','after']])assert.equal(verifyCommanderModelReceipt(decision.model_receipt,{...scope,[key]:value}),false);
 assert.equal(verifyCommanderModelReceipt({...decision.model_receipt,response_id:'official-turn'},scope),false);
 assert.equal(verifyCommanderModelReceipt({...decision.model_receipt,raw_response:output+' '},scope),false);
});
for(const bad of [{provider:null},{model:'unknown'},{terminalReceipt:null},{terminalReceipt:{runId:'wrong',sessionId:'official-session',turnId:'official-turn',effective:{provider:'openai',model:'gpt-6.1-sol'}}}])test('101不得凭成功文本伪报缺失或冲突的模型元数据 '+JSON.stringify(bad),async t=>{
 await assert.rejects(openClawCommander({home:home(t),execute:async()=>({stdout:JSON.stringify(raw(bad))})})(scope),/COMMANDER_MODEL_RECEIPT_INVALID/);
});
