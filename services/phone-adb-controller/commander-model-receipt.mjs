import {createHash} from 'node:crypto';
const scopeKeys=['workflow_key','run_id','binding_id','task_id','source_commit','activity','phase'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const text=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=250&&!/[\r\n]/.test(value)&&!['unknown','undefined','null'].includes(value);
const invalid=()=>{throw Error('COMMANDER_MODEL_RECEIPT_INVALID');};
export function commanderModelReceipt(raw,scope){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>1024*1024)invalid();
 const body=JSON.parse(raw),meta=(body.result??body).meta?.agentMeta,terminal=meta?.terminalReceipt;
 if(scope.workflow_key!=='douyin_video_discovery'||!text(scope.run_id)||!text(scope.binding_id)||! /^[a-f0-9]{40}$/.test(scope.source_commit||'')||!text(scope.activity)||!['before','after'].includes(scope.phase))invalid();
 if(!meta||!text(meta.provider)||!text(meta.model)||!terminal||!text(terminal.runId)||!text(terminal.sessionId)||!text(terminal.turnId)||meta.sessionId!==terminal.sessionId||terminal.effective?.provider!==meta.provider||terminal.effective?.model!==meta.model||body.runId!==undefined&&body.runId!==terminal.runId)invalid();
 if(body.status&&!['ok','completed','success'].includes(body.status)||body.error||body.ok===false)invalid();
 // OpenClaw 2026.9.8正式CLI未公开供应商responseId。runId/turnId保持原身份，不作为替代。
 return {version:1,scope:Object.fromEntries(scopeKeys.map(k=>[k,scope[k]??null])),provider:meta.provider,model:meta.model,
  response_id:null,response_id_reason:'provider_not_exposed',openclaw:{run_id:terminal.runId,session_id:terminal.sessionId,turn_id:terminal.turnId},
  assistant_turns:Number.isSafeInteger(meta.assistantTurns)&&meta.assistantTurns>0?meta.assistantTurns:null,
  provider_call_count:null,provider_call_count_reason:'complete_provider_call_coverage_not_exposed',
  raw_response:raw,response_sha256:hash(raw)};
}
export function verifyCommanderModelReceipt(receipt,scope){
 try{return JSON.stringify(commanderModelReceipt(receipt.raw_response,scope))===JSON.stringify(receipt);}catch{return false;}
}
export function summarizeCommanderEvidence(events,scope){
 const calls=events.filter(e=>['before','after'].includes(e.phase)),counts=new Map();
 for(const e of calls){const p=e.decision?.model_receipt;if(e.commander_status==='available'&&verifyCommanderModelReceipt(p,{...scope,activity:e.activity,phase:e.phase})){const key=JSON.stringify(p.openclaw);counts.set(key,(counts.get(key)||0)+1);}}
 const valid=calls.filter(e=>e.commander_status==='available'&&verifyCommanderModelReceipt(e.decision?.model_receipt,{...scope,activity:e.activity,phase:e.phase})&&counts.get(JSON.stringify(e.decision.model_receipt.openclaw))===1).map(e=>e.decision.model_receipt);
 const turns=valid.filter(p=>p.assistant_turns!==null);
 return {consultations:calls.length,verified_cli_receipts:valid.length,failed_consultations:calls.filter(e=>e.commander_status!=='available').length,
  missing_or_invalid_receipts:calls.length-valid.length,assistant_turns:turns.length?turns.reduce((sum,p)=>sum+p.assistant_turns,0):null,
  assistant_turns_coverage:valid.length===calls.length&&turns.length===valid.length&&valid.length>0?'complete_observed_cli':'partial',provider_call_count:null,provider_call_count_status:'unknown',response_ids_verified:0,response_ids_unavailable:valid.length};
}
