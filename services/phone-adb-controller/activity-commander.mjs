import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const safeError = error => String(error?.message || error)
  .replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
  .replace(/(?:api[_-]?key|token|password)\s*[=:]\s*[^\s"']+/gi, '凭据=***').slice(0, 400);
const workflowProgressRule = 'workflow_progress.remaining_activity_keys列出真实剩余活动。单个活动成功不等于全流程完成；当前活动成功且还有剩余活动时应continue。finish是停止整个流程并清场，正常完成只能在最后活动成功后使用；提前安全停止必须明确停止原因，不能把活动完成当全流程完成。';

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

// 会话按run+活动隔离；活动前后共用上下文。执行权仍属于已冻结的脚本，模型不产生shell命令。
export function openClawCommander({ agent = 'media', model, timeoutMs = 60000, execute = exec } = {}) {
  return async receipt => {
    const key = `leadgen-${receipt.run_id}-${receipt.activity}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const prompt = `你是智能获客逐活动Commander。只分析提供的本次证据，不调用任何工具、不自行发私信或改网络、账号、代码、定时器。`
      + `只输出JSON {"action":"continue|retry|finish|escalate","reason":"证据与理由"}。`
      + `retry仅建议失败活动重试，finish要求执行器保留产物并清场。读不到必须写读不到，不得编造成功。\n${JSON.stringify(receipt)}`;
    const args = ['agent', '--agent', agent, '--session-id', key, '--thinking', 'low',
      '--timeout', String(Math.floor(timeoutMs / 1000)), '--json', '--message', workflowProgressRule+prompt];
    if (model) args.push('--model', model);
    try {
      const { stdout } = await execute('openclaw', args, { timeout: timeoutMs + 5000, maxBuffer: 1024 * 1024 });
      return parseCommanderResponse(stdout);
    } catch (error) {
      // execFile错误通常包含完整prompt/argv；绝不把它原样写进回执。
      throw Error(`COMMANDER_UNAVAILABLE code=${String(error.code || 'invalid_response')} signal=${String(error.signal || '')}`);
    }
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

export async function runActivity({ activity, context, execute, commander, record }) {
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
      await record({ ...receipt, commander_status: commanderStatus, error: safeError(error) });
      if (!cleanup) throw error;
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
    try { evidence = { status: 'completed', attempt, result: await execute() }; }
    catch (error) { evidence = { status: 'failed', attempt, error: safeError(error) }; }
    await record({ ...context, activity: activity.key, phase: 'execution', evidence });
    const after = await consult('after', evidence);
    if (evidence.status === 'failed' && after.action === 'retry' && attempt < maxAttempts) continue;
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
