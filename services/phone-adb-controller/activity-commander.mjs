import {randomUUID} from 'node:crypto';
import { createRequire } from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {execFileReceipt,executionDidNotStart} from './leadgen-client.mjs';
import {commanderModelReceipt} from './commander-model-receipt.mjs';
const exec = execFileReceipt;
const require = createRequire(import.meta.url);
const safeError = error => String(error?.message || error)
  .replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
  .replace(/(?:api[_-]?key|token|password)\s*[=:]\s*[^\s"']+/gi, '凭据=***').slice(0, 400);
const workflowProgressRule = '活动顺序、通过与否、重试及清场均由代码负责。remaining_activity_keys是剩余活动，单活动完成不表示整轮完成。你只能观察、回答问题、给执行Agent一条具体纠偏或请求中止当前Agent；不得批准发送、发布、删除、付款。';

export function parseCommanderResponse(raw) {
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const payloads = body?.result?.payloads ?? body?.payloads;
  if (body?.error || body?.ok === false || body?.status && !['ok', 'completed', 'success'].includes(body.status)
      || !Array.isArray(payloads)) throw Error('Commander没有成功响应');
  const text = payloads.map(p => p.text || '').join('\n').trim();
  const decision = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (decision.action==='none')return {action:'none'};
  if (['steer','answer'].includes(decision.action)&&typeof decision.text==='string'&&decision.text.trim())return {action:decision.action,text:decision.text.slice(0,16000),...(typeof decision.reason==='string'?{reason:decision.reason.slice(0,400)}:{}),...(typeof decision.trace==='string'?{trace:decision.trace.slice(0,16000)}:{})};
  if (!['abort','continue','retry','finish','escalate'].includes(decision.action)||typeof decision.reason!=='string'||!decision.reason.trim())throw Error('Commander回执格式无效');
  return {action:decision.action,reason:decision.reason.slice(0,400),...(typeof decision.trace==='string'?{trace:decision.trace.slice(0,16000)}:{})};
}

// Activity changes do not create a new owner. Source changes cannot adopt an
// existing owner's context; the run's frozen source is part of the identity.
export {workflowCommanderSession,reserveWorkflowCommanderTurn,assertWorkflowOwnerAvailable} from './commander-owner-state.mjs';
import {workflowCommanderSession,reserveWorkflowCommanderTurn,ownerPending} from './commander-owner-state.mjs';
export {reconcileWorkflowCommanderTurn} from './commander-owner-reconcile.mjs';

export function openClawCommander({ agent = 'work-commander', model, timeoutMs = 60000, execute = exec,home=homedir() } = {}) {
  if(agent!=='work-commander')throw Error('COMMANDER_OWNER_AGENT_INVALID');
  return async receipt => {
    const key = workflowCommanderSession(receipt);
    const prompt = `你是本Workflow唯一的Commander负责人，本轮是节点证据判读，不是新的执行任务。当前判读只分析提供的证据，不调用任何工具、不自行发私信或改网络、账号、代码、定时器。`
      + `只输出JSON action=none|answer|steer|abort；answer/steer必须附text，abort必须附reason。steer/abort附trace：发生了什么→告诉执行者怎么改→对应规则。固定Commander Skill：\n${receipt.skill?.content||'未提供固定Skill，明确证据不足。'}\n`
      + `你只观察与纠偏，不判定状态、不选择下一活动、不批准外部动作。steer应指出规则或完成标准；读不到必须说明证据不足。\n${JSON.stringify(receipt)}`;
    const requestId=randomUUID(),params={agentId:agent,sessionKey:key,thinking:'low',timeout:Math.floor(timeoutMs/1000),
      modelRun:true,idempotencyKey:requestId,message:workflowProgressRule+prompt};
    if(model)params.model=model;
    const args=['gateway','call','agent','--expect-final','--json','--timeout',String(timeoutMs+5000),'--params',JSON.stringify(params)];
    const reservation=await reserveWorkflowCommanderTurn(receipt,{home});
    const started=performance.now();let status='transport_error';
    try {
      await reservation.check();
      const { stdout } = await execute('openclaw', args, { timeout: timeoutMs + 5000, maxBuffer: 1024 * 1024 });
      status='protocol_invalid';const body=JSON.parse(stdout);
      if(body?.status==='accepted'){status='nonfinal';throw Error('COMMANDER_GATEWAY_FINAL_REQUIRED');}
      if(body?.status==='timeout'){status='execution_timeout';throw Error('COMMANDER_GATEWAY_TIMEOUT');}
      if(body?.runId!==requestId){status='identity_conflict';throw Error('COMMANDER_GATEWAY_IDENTITY_INVALID');}
      const decision=parseCommanderResponse(stdout);
      if(receipt.workflow_key==='douyin_video_discovery'){
        status='identity_conflict';decision.model_receipt=commanderModelReceipt(stdout,receipt);
      }
      // Only this request's verified final can release the original reservation.
      await reservation.returned(stdout);
      return decision;
    } catch (error) {
      const notStarted=executionDidNotStart(error,'openclaw',args);
      if(notStarted)await reservation.notStarted(error,'openclaw',args);
      if(error.killed||error.code==='ETIMEDOUT')status='transport_timeout';
      const code=Number.isInteger(error.code)&&error.code>=0&&error.code<=255?String(error.code):['ENOENT','EACCES','ETIMEDOUT'].includes(error.code)?error.code:'invalid_response';
      const signal=['SIGTERM','SIGKILL','SIGINT'].includes(error.signal)?error.signal:'';
      const unavailable=Error(error.message==='COMMANDER_MODEL_RECEIPT_INVALID'?'COMMANDER_MODEL_RECEIPT_INVALID':'COMMANDER_UNAVAILABLE code='+code+' signal='+signal);
      unavailable.executionStopped=notStarted;
      unavailable.commanderDiagnostic={activity:receipt.activity,phase:receipt.phase,run_id:receipt.run_id,gateway_run_id:requestId,status,elapsed_ms:Math.max(0,Math.round(performance.now()-started)),timeout_ms:timeoutMs};
      try{
        const {file}=ownerPending(receipt,home),scope=Object.fromEntries(['workflow_key','run_id','binding_id','task_id','source_commit','activity','phase'].map(k=>[k,receipt[k]??null]));
        writeFileSync(file.replace(/\.pending\.json$/,'.'+requestId+'.diagnostic.json'),JSON.stringify({protocol:'commander-diagnostic-v1',scope,diagnostic:unavailable.commanderDiagnostic})+'\n',{flag:'wx',mode:0o600});
        unavailable.commanderDiagnosticPersisted=true;
      }catch{unavailable.commanderDiagnosticPersisted=false;}
      throw unavailable;
    }finally{await reservation.close();}
  };
}

// 沿用生产的Gemini复核模型与1Password同步镜像；独立HTTP调用不依赖OpenClaw网关状态。
export function openRouterCommander({ model = 'google/gemini-2.5-flash', timeoutMs = 60000,
  fetchImpl = fetch, apiKey } = {}) {
  return async receipt => {
    const key = apiKey || require('./judge-jev.js').resolveOpenRouterKey();
    if (!key) throw Error('COMMANDER_AUTH_UNAVAILABLE');
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 350,
        response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: '你是逐活动Commander。reason必须是简体中文。只根据本次证据判断；缺信息说读不到，不编造成功。不能发私信或变更网络、账号、凭据、代码和定时器。只输出JSON action=none|answer|steer|abort，answer/steer附text、abort附reason。只观察与纠偏，不判定状态或顺序，不批准外部动作。'+workflowProgressRule+'\n固定Commander Skill：\n'+(receipt.skill?.content||'未提供固定Skill，明确证据不足。') },
          { role: 'user', content: JSON.stringify(receipt) },
        ] }),
    });
    if (!response.ok) throw Error(`COMMANDER_HTTP_${response.status}`);
    const body = await response.json();
    if (body.error) throw Error('COMMANDER_API_ERROR');
    const decision = parseCommanderResponse({ status: 'ok', payloads: [{ text: body.choices?.[0]?.message?.content }] });
    return { ...decision, provider: 'openrouter', model:body.model||'unknown',configured_model:model,response_id:body.id||null };
  };
}

// Exact producer error names: capability/strategy/evidence gaps are not UI repair requests.
export const isCaptureContractFailure=evidence=>/\b(?:RECORD_AUDIO_STRATEGY_UNSUPPORTED|RECORD_AUDIO_CAPTURE_UNAVAILABLE|RECORD_AUDIO_TRACK_UNVERIFIED|RECORD_CAPTURE_STRATEGY_UNVERIFIED|RECORD_CAPTURE_SILENT|RECORD_AUDIO_DECODE_UNVERIFIED)\b/.test(JSON.stringify(evidence));

export {runWorkflow,runActivity} from './leadgen-runner-adapter.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = JSON.parse(readFileSync(0, 'utf8'));
    const decision = await openRouterCommander()(receipt);
    process.stdout.write(JSON.stringify({ ok: true, decision }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: safeError(error) }) + '\n');
    process.exitCode = 1;
  }
}

