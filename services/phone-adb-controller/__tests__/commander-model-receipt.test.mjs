import {gatewayFixture} from './fixtures/commander-gateway-response.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClawCommander} from '../activity-commander.mjs';
const scope={workflow_key:'douyin_video_discovery',run_id:'douyin_video_discovery-proof__a1',binding_id:'binding-proof',task_id:null,source_commit:'a'.repeat(40),activity:'collect_videos',phase:'before'};
function raw(overrides={}){return {status:'ok',runId:'official-run',result:{payloads:[{text:JSON.stringify({action:'continue',reason:'实际回执'})}],meta:{agentMeta:{provider:'openai',model:'gpt-6.1-sol',sessionId:'official-session',assistantTurns:2,terminalReceipt:{runId:'official-run',sessionId:'official-session',turnId:'official-turn',effective:{provider:'openai',model:'gpt-6.1-sol',responseModel:'gpt-6.1-sol'}},...overrides}}}};}
function home(t){const p=mkdtempSync(join(tmpdir(),'commander-model-proof-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('正式Commander保存供应商元数据和官方运行链，不将官方turn冒response_id',async t=>{
 let output;const decision=await openClawCommander({home:home(t),execute:async(_cmd,args)=>({stdout:output=gatewayFixture(raw(),args)})})(scope);
 assert.equal(decision.model_receipt.provider,'openai');assert.equal(decision.model_receipt.model,'gpt-6.1-sol');assert.equal(decision.model_receipt.response_id,null);assert.equal(decision.model_receipt.response_id_reason,'provider_not_exposed');
 assert.equal(decision.model_receipt.openclaw.run_id,JSON.parse(output).runId);assert.equal(decision.model_receipt.openclaw.turn_id,'official-turn');assert.equal(decision.model_receipt.assistant_turns,2);assert.equal(decision.model_receipt.provider_call_count,null);assert.equal(decision.model_receipt.raw_response,output);
 const {verifyCommanderModelReceipt}=await import('../commander-model-receipt.mjs');assert.equal(verifyCommanderModelReceipt(decision.model_receipt,scope),true);
 for(const [key,value] of [['run_id','foreign'],['source_commit','b'.repeat(40)],['activity','cleanup'],['phase','after']])assert.equal(verifyCommanderModelReceipt(decision.model_receipt,{...scope,[key]:value}),false);
 assert.equal(verifyCommanderModelReceipt({...decision.model_receipt,response_id:'official-turn'},scope),false);
 assert.equal(verifyCommanderModelReceipt({...decision.model_receipt,raw_response:output+' '},scope),false);
});
for(const bad of [{provider:null},{model:'unknown'},{terminalReceipt:null},{terminalReceipt:{runId:'wrong',sessionId:'official-session',turnId:'official-turn',effective:{provider:'openai',model:'gpt-6.1-sol'}}}])test('101不得凭成功文本伪报缺失或冲突的模型元数据 '+JSON.stringify(bad),async t=>{
 const dir=home(t);let output;
 await assert.rejects(openClawCommander({home:dir,execute:async(_cmd,args)=>({stdout:output=gatewayFixture(raw(bad),args)})})(scope),/COMMANDER_MODEL_RECEIPT_INVALID/);
 const folder=join(dir,'.openclaw/leadgen-owner-turns'),files=readdirSync(folder);
 assert.equal(files.some(n=>n.endsWith('.returned.json')),false,'invalid final cannot release the owner');
 const proof=JSON.parse(readFileSync(join(folder,files.find(n=>n.endsWith('.pending.json'))),'utf8'));assert.equal(proof.status,'reserved');assert.equal(proof.run_id,scope.run_id);assert.equal(proof.source_commit,scope.source_commit);assert.ok(output);
});

test('调用统计区分可核咨询、失败与unknown，不把缺失供应商调用数记零',async()=>{
 const {commanderModelReceipt,summarizeCommanderEvidence}=await import('../commander-model-receipt.mjs');
 const proof=commanderModelReceipt(JSON.stringify(raw()),scope);
 const events=[{...scope,commander_status:'available',decision:{model_receipt:proof}},{...scope,phase:'after',commander_status:'unavailable',error:'timeout'}];
 assert.deepEqual(summarizeCommanderEvidence(events,scope),{consultations:2,verified_cli_receipts:1,failed_consultations:1,missing_or_invalid_receipts:1,assistant_turns:2,assistant_turns_coverage:'partial',provider_call_count:null,provider_call_count_status:'unknown',response_ids_verified:0,response_ids_unavailable:1});
 const duplicate=summarizeCommanderEvidence([events[0],events[0]],scope);assert.equal(duplicate.verified_cli_receipts,0);assert.equal(duplicate.assistant_turns,null);assert.equal(duplicate.missing_or_invalid_receipts,2);
});
