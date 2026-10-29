import {randomUUID} from 'node:crypto';
import {collectionEvidenceProof,collectionReturnedEvidence} from './collection-phone-scope.mjs';
import {discoveryCleanupEvidence,discoveryFiniteStopEvidence} from './discovery-phone-scope.mjs';
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
const workflowProgressRule = 'workflow_progress.remaining_activity_keys列出当前活动之后的剩余活动，不含当前活动；当前活动pending表示即将执行，不表示已跳过。单个活动成功不等于全流程完成；当前活动成功且还有剩余活动时应continue。evidence.status为partial/failed表示本活动未完整完成，不能称其成功，须依据stop_reason及实际保存数量说明。finish是停止整个流程并清场，正常完成只能在最后活动成功后使用；提前安全停止必须明确停止原因，不能把活动完成当全流程完成。';

export function parseCommanderResponse(raw) {
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const payloads = body?.result?.payloads ?? body?.payloads;
  if (body?.error || body?.ok === false || body?.status && !['ok', 'completed', 'success'].includes(body.status)
      || !Array.isArray(payloads)) throw Error('Commander没有成功响应');
  const text = payloads.map(p => p.text || '').join('\n').trim();
  const decision = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (!['continue', 'retry', 'finish', 'escalate'].includes(decision.action)
      || typeof decision.reason !== 'string' || !decision.reason.trim()) throw Error('Commander回执格式无效');
  return { action: decision.action, reason: decision.reason.slice(0, 400) };
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
      + `只输出JSON {"action":"continue|retry|finish|escalate","reason":"证据与理由"}。`
      + `retry仅建议失败活动重试，finish要求执行器保留产物并清场。读不到必须写读不到，不得编造成功。\n${JSON.stringify(receipt)}`;
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
          { role: 'system', content: '你是逐活动Commander。reason必须是简体中文。只根据本次证据判断；缺信息说读不到，不编造成功。不能发私信或变更网络、账号、凭据、代码和定时器。只输出JSON action=continue|retry|finish|escalate和reason。失败仅建议安全重试；finish由执行器保留产物后清场。'+workflowProgressRule },
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

export async function runActivity({ activity, context, execute, commander, record, recover }) {
  const cleanup = activity.key === 'cleanup';
  let commanderStatus = 'available';
  const consult = async (phase, evidence) => {
    const receipt = { ...context, activity: activity.key, phase, evidence };
    try {
      const decision = await commander(receipt);
      if (!['continue', 'retry', 'finish', 'escalate'].includes(decision?.action)) throw Error('COMMANDER_INVALID_DECISION');
      await record({ ...receipt, commander_status: 'available', decision });
      return decision;
    } catch (error) {
      commanderStatus = 'unavailable';
      await record({ ...receipt, commander_status: commanderStatus, error: safeError(error),...(error.commanderDiagnostic?{commander_diagnostic:error.commanderDiagnostic}:{}) });
      if (!cleanup||error.executionStopped===false) throw error;
      return { action: 'continue', reason: 'Commander不可达，仍必须在持锁状态下清场' };
    }
  };
  const before = await consult('before', { status: 'pending' });
  if (!cleanup && ['finish', 'escalate'].includes(before.action)) {
    return { status: 'partial', commander_status: commanderStatus, decision: before };
  }
  const maxAttempts = activity.retry_safe === true ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let evidence;
    try {
      const result=await execute();
      // A handler may omit status on success, but an explicit non-success state
      // must never be promoted to completed by an unfamiliar status spelling.
      const reported=result?.status;
      const status=reported===undefined||reported==='completed'?'completed'
        :['paused','partial','blocked','needs_review','pending'].includes(reported)?'partial'
        :reported==='skipped'?'skipped':'failed';
      evidence = { status, attempt, result };
    }
    catch (error) { evidence = { status: 'failed', attempt, error: safeError(error),...(typeof error.executionStopped==='boolean'?{execution_stopped:error.executionStopped}:{}) ,...(error.externalEffect==='unknown'?{external_effect:'unknown'}:{}),...(error.operationId?{operation_id:error.operationId}:{}) }; }
    await record({ ...context, activity: activity.key, phase: 'execution', evidence });
    // Parent close after SIGTERM/output truncation does not prove its process group stopped.
    // Do not retry, hand over, or clear resources until an independent stop readback exists.
    const phoneScope=collectionEvidenceProof(evidence,{run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:activity.key});
    const cleanupOnly=discoveryCleanupEvidence(evidence,{run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:activity.key});
    if(!phoneScope&&!cleanupOnly&&(evidence.execution_stopped===false||evidence.result?.execution_stopped===false||(evidence.execution_stopped!==true&&/\b(?:EXECUTION_OUTPUT_LIMIT|EXECUTION_DEADLINE|RECORD_CAPTURE_EXIT_UNVERIFIED)\b/.test(JSON.stringify(evidence))))){
      return {...evidence,status:'failed',execution_stopped:false,commander_status:commanderStatus,decision:{action:'escalate',reason:'原执行者终止未验证，保留资源'}};
    }
    const after = await consult('after', evidence);
    if(cleanupOnly&&['partial','failed'].includes(evidence.status))return {...evidence,commander_status:commanderStatus,decision:{action:'finish',reason:'封闭手机请求已归还，仅执行原run清场；保留采集失败或部分结果'}};
    if(isCaptureContractFailure(evidence))return {...evidence,commander_status:commanderStatus,decision:{action:'escalate',reason:'音频能力或捕获合同证据缺口，不重试或用UI代修'},failure_class:'capture_contract_blocked'};
    if (evidence.status === 'failed' && evidence.execution_stopped!==true && after.action === 'retry' && attempt < maxAttempts) continue;
    if (recover && ['failed','partial'].includes(evidence.status) && !['finish','escalate'].includes(after.action)) {
      try {
        const candidate = await recover(evidence);
        if (!candidate || !['completed','failed','partial'].includes(candidate.status) || typeof candidate.execution_stopped !== 'boolean') throw Error('SKILL_RECOVERY_RECEIPT_INVALID');
        await record({ ...context, activity: activity.key, phase: 'skill_execution', evidence: candidate, code_failure: evidence });
        return { ...candidate, ...(evidence.external_effect==='unknown'?{external_effect:'unknown'}:{}), code_failure: evidence, commander_status: commanderStatus, decision: after };
      } catch (error) {
        await record({ ...context, activity: activity.key, phase: 'skill_failure', error: safeError(error), code_failure: evidence });
        return { ...evidence, execution_stopped: error.executionStopped === true, skill_error: safeError(error), commander_status: commanderStatus, decision: after };
      }
    }
    return { ...evidence, commander_status: commanderStatus, decision: after };
  }
}

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

// 任一普通活动失败或Commander叫停，停止后续业务；清场总在最后执行。
export async function runWorkflow({activities,context,handlers,commander,record,verify,recover,quarantine,terminationUnverified=()=>false}) {
  const results=[];let status='completed',stopped=false;
  const ordered=[...activities.filter(a=>a.key!=='cleanup'),...activities.filter(a=>a.key==='cleanup')];
  const execute=async activity=>{
    if(typeof handlers[activity.key]!=='function')throw Error(`活动缺实现: ${activity.key}`);
    try {
      const remaining=ordered.slice(ordered.indexOf(activity)+1).map(a=>a.key);
      const activityContext={...context,workflow_progress:{completed_activity_keys:results.filter(r=>['completed','skipped'].includes(r.status)).map(r=>r.activity),
        remaining_activity_keys:remaining}};
      let result=await runActivity({activity,context:activityContext,execute:handlers[activity.key],commander,record,
        recover:recover?failure=>recover({activity,failure,context:activityContext,execute:handlers[activity.key]}):undefined});
      if(['paused','partial'].includes(result.result?.status))result.status='partial';
      if(result.result?.status==='skipped')result.status='skipped';
      const scope={run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:activity.key};
      const verifySamplePartial=activity.key==='collection'&&result.status==='partial'&&result.result?.sampling_receipts?.length>0;
      const verifyFiniteDiscovery=activity.key==='collect_videos'&&result.status==='partial'&&discoveryFiniteStopEvidence(result,scope);
      if((result.status==='completed'||verifySamplePartial||verifyFiniteDiscovery)&&verify){
        const completedCode=result.status==='completed';
        result.verification=await verify(activity,result);
        if(result.verification.verified!==true){
          result.status='failed';
          // Reuse the original run's restricted handoff. Never replay Code here,
          // reopen an already attempted Skill, or hand off an unknown executor.
          const mayRecover=completedCode&&recover&&activity.key!=='cleanup'&&!discoveryCleanupEvidence(result,{run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:activity.key})&&!result.code_failure&&!result.skill_error
            &&result.execution_stopped!==false&&result.result?.execution_stopped!==false
            &&!['finish','escalate'].includes(result.decision?.action);
          if(mayRecover){
            const codeFailure=result;
            await record({...activityContext,activity:activity.key,phase:'verification',evidence:codeFailure});
            try{
              const candidate=await recover({activity,failure:codeFailure,context:activityContext,execute:handlers[activity.key]});
              if(!candidate||!['completed','failed','partial'].includes(candidate.status)||typeof candidate.execution_stopped!=='boolean')throw Error('SKILL_RECOVERY_RECEIPT_INVALID');
              result={...candidate,code_failure:codeFailure,commander_status:codeFailure.commander_status,decision:codeFailure.decision};
              await record({...activityContext,activity:activity.key,phase:'skill_execution',evidence:result});
              if(result.status==='completed'&&result.execution_stopped===true){
                result.verification=await verify(activity,result);
                if(result.verification.verified!==true)result.status='failed';
              }
            }catch(error){
              result={...codeFailure,code_failure:codeFailure,execution_stopped:error.executionStopped===true,skill_error:safeError(error)};
              await record({...activityContext,activity:activity.key,phase:'skill_failure',error:safeError(error),code_failure:codeFailure});
            }
          }
        }
      }
      if(result.code_failure)await record({...activityContext,activity:activity.key,phase:'verification',evidence:result});
      results.push({activity:activity.key,...result});
      // 清场完成后Commander正常finish是收尾结果；业务提前停止、失败与升级仍如实保留。
      const normalCleanupFinish=activity.key==='cleanup'&&['completed','skipped'].includes(result.status)&&result.decision?.action==='finish';
      const normalFinalFinish=remaining.length===0&&result.status==='completed'&&result.decision?.action==='finish';
      if(result.status==='failed'){status='failed';stopped=true;}
      else if(result.status==='partial'||(['finish','escalate'].includes(result.decision?.action)&&!normalCleanupFinish&&!normalFinalFinish)
        ||result.result?.status==='partial'||result.result?.status==='paused'){
        if(status!=='failed')status='partial';stopped=true;
      }
      if(result.execution_stopped===false&&!discoveryCleanupEvidence(result,{run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:activity.key})){context={...context,skill_execution_unknown:true};status='failed';stopped=true;}
    }catch(error){
      if(error.executionStopped===false||terminationUnverified())context={...context,skill_execution_unknown:true};
      status='failed';stopped=true;
      const result={activity:activity.key,status:'failed',error:String(error.message).slice(0,400)};
      results.push(result);
      try{await record({...context,...result,phase:'failure'});}catch(recordError){result.record_error=safeError(recordError);}
    }
  };
  try {for(const a of activities.filter(a=>a.key!=='cleanup')){
    if(stopped){results.push({activity:a.key,status:'blocked',reason:'前序活动未通过或Commander要求收工'});continue;}
    await execute(a);
  }}finally{
    const last=results.at(-1),cleanupScope=last&&{run_id:context.run_id,task_id:context.task_id??null,source_commit:context.source_commit,activity:last.activity};
    const cleanupOnly=last&&(discoveryCleanupEvidence(last,cleanupScope)||collectionReturnedEvidence(last,cleanupScope));
    if(stopped&&terminationUnverified()&&!cleanupOnly)context={...context,skill_execution_unknown:true};
    for(const a of activities.filter(a=>a.key==='cleanup')){
    if(context.skill_execution_unknown){results.push({activity:a.key,status:'blocked',reason:'原执行或Skill子会话终止未知，禁止清场并记录资源隔离'});status='failed';}
    else await execute(a);
  }}
  let resource_quarantine;
  if(context.skill_execution_unknown){
    try{resource_quarantine=quarantine?await quarantine():{verified:false,reason:'persistent quarantine adapter unavailable'};}
    catch(error){resource_quarantine={verified:false,reason:String(error.message).slice(0,400)};}
    await record({...context,phase:'resource_quarantine',evidence:resource_quarantine});
  }
  return {status,results,...(resource_quarantine?{resource_quarantine}:{})};
}


