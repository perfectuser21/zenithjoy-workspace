import { createHash } from 'node:crypto';

export const PIPELINE_STAGES = ['research', 'copywriting', 'copy_review', 'generate', 'image_review', 'export'];
export const PIPELINE_CAPABILITIES = Object.freeze({
  content_type: 'solo-company-case', label: '案例内容', stages: PIPELINE_STAGES, notebook_source: 'topic',
});
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface BrainClaim { brain_task_id: string; claimer: string; claim_epoch: string }
export class BrainTaskError extends Error {
  constructor(message: string, public status = 502, public registrationStatus: 'unknown' | 'rejected' = 'rejected') { super(message); }
}
export function readBrainClaim(value: unknown): BrainClaim | null {
  if (!value || typeof value !== 'object') return null;
  const x = value as Record<string, unknown>;
  if (typeof x.brain_task_id !== 'string' || !UUID_RE.test(x.brain_task_id)
    || typeof x.claimer !== 'string' || !x.claimer.trim() || x.claimer.length > 200
    || typeof x.claim_epoch !== 'string' || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(x.claim_epoch)) return null;
  return { brain_task_id: x.brain_task_id, claimer: x.claimer, claim_epoch: x.claim_epoch };
}
export function sameBrainClaim(a: unknown, b: BrainClaim): boolean {
  const x = readBrainClaim(a);
  return !!x && x.brain_task_id === b.brain_task_id && x.claimer === b.claimer && x.claim_epoch === b.claim_epoch;
}
const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical((x as Record<string, unknown>)[k])])) : x;
export const resultDigest = (x: unknown): string => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
async function brainPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: globalThis.Response;
  try {
    response = await fetch(`${process.env.CECELIA_BRAIN_URL || 'http://localhost:5221'}/api/brain/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new BrainTaskError('Brain任务服务不可达', 502, 'unknown'); }
  if (!response.ok) throw new BrainTaskError('Brain任务服务拒绝请求', response.status === 409 ? 409 : 502, response.status >= 500 ? 'unknown' : 'rejected');
  try { return await response.json() as Record<string, unknown>; } catch { throw new BrainTaskError('Brain任务回执格式无效', 502, 'unknown'); }
}
export async function registerPipelineTask(run: Record<string, unknown>): Promise<string> {
  const receipt = await brainPost('tasks', {
    title: `Content Pipeline ${run.id}: ${run.topic || run.content_type}`,
    task_type: 'content-pipeline', priority: 'P2', mutation_intent: 'read_only',
    source_id: `zenithjoy:pipeline:${run.id}`,
    trigger_source: 'api',
    payload: { zenithjoy_pipeline_run_id: run.id, business_owner: 'zenithjoy', delivery_type: 'external_execution' },
  });
  const wrapped = (receipt.task ?? receipt) as Record<string, unknown>;
  if (typeof wrapped.id !== 'string' || !UUID_RE.test(wrapped.id)
    || (wrapped.payload as Record<string, unknown> | undefined)?.zenithjoy_pipeline_run_id !== run.id) throw new BrainTaskError('Brain未返回有效任务编号', 502, 'unknown');
  return wrapped.id;
}
export async function validateBrainLease(identity: BrainClaim): Promise<void> {
  const receipt = await brainPost(`tasks/${identity.brain_task_id}/heartbeat`, {
    claimer: identity.claimer, claim_epoch: identity.claim_epoch,
  });
  if (receipt.ok !== true || typeof receipt.lease_until !== 'string') throw new BrainTaskError('Brain租约回执无效');
}
export async function confirmBrainFinish(identity: BrainClaim, status: 'completed' | 'failed', result: unknown): Promise<void> {
  const response = await brainPost(`tasks/${identity.brain_task_id}/lease/finish`, {
    claimer: identity.claimer, claim_epoch: identity.claim_epoch, status, result,
  });
  const r = response.receipt as Record<string, unknown> | undefined;
  if (response.ok !== true || response.task_id !== identity.brain_task_id || response.status !== status
    || r?.claimer !== identity.claimer || r.claim_epoch !== identity.claim_epoch || r.status !== status
    || r.result_sha256 !== resultDigest(result)) throw new BrainTaskError('Brain终态回执身份或结果不匹配');
}
