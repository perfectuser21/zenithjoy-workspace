import pool from '../db/connection';
import { saveShot } from './worker-shots';
import { ONLINE_WINDOW_SQL } from './agent-machines-normalize';

export const LEASE_MS = 10 * 60 * 1000;
const MAX_SHOT_B64 = Math.ceil(200 * 1024 * 4 / 3);
export type StepStatus = 'doing' | 'done' | 'failed';
export type Outcome = 'completed' | 'failed' | 'needs_review';

export class WorkerTaskError extends Error {
  constructor(public code: string, message: string, public httpStatus: number) {
    // message 里带 code 前缀：调用方（包括测试）常用 code 做 toThrow(/CODE/) 断言。
    super(`${code}: ${message}`);
  }
}

export interface StepReport {
  step_index: number; status: StepStatus; executor_id: string;
  screenshot_jpeg_b64?: string; foreground_pkg?: string; diag_line?: string; note?: string;
}

/** 截图 base64 超限 → SCREENSHOT_TOO_LARGE；供 validateStepReport 与 completeTask(evidence) 共用 */
export function assertShotSize(b64?: string): void {
  if (b64 && b64.length > MAX_SHOT_B64) {
    throw new WorkerTaskError('SCREENSHOT_TOO_LARGE', '截图 ≤200KB', 400);
  }
}

export function validateStepReport(r: StepReport): void {
  if (!r || !Number.isInteger(r.step_index) || r.step_index < 0
      || !['doing', 'done', 'failed'].includes(r.status)
      || typeof r.executor_id !== 'string' || !r.executor_id) {
    throw new WorkerTaskError('INVALID_STEP', 'step_index 须为非负整数，status ∈ doing|done|failed，executor_id 必填', 400);
  }
  assertShotSize(r.screenshot_jpeg_b64);
  if (r.status === 'failed' && !(r.foreground_pkg && r.diag_line && r.screenshot_jpeg_b64)) {
    throw new WorkerTaskError('FAILURE_SCENE_REQUIRED', '失败上报必须带现场三件套：foreground_pkg + diag_line + screenshot_jpeg_b64', 400);
  }
}

export async function startTask(input: { agentId: string; title: string; steps: string[]; executorId: string }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agent = await client.query(`SELECT id, tenant_id FROM zenithjoy.agents WHERE id = $1`, [input.agentId]);
    if (agent.rows.length === 0) throw new WorkerTaskError('AGENT_NOT_FOUND', 'worker 不存在', 404);
    const tenantId = agent.rows[0].tenant_id as string;
    let task;
    try {
      task = await client.query(
        `INSERT INTO zenithjoy.worker_tasks (tenant_id, agent_id, title, executor_id, steps_total, lease_until)
         VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' milliseconds')::interval)
         RETURNING id, lease_until`,
        [tenantId, input.agentId, input.title, input.executorId, input.steps.length, String(LEASE_MS)],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new WorkerTaskError('WORKER_BUSY', '该 worker 已有执行中的任务', 409);
      throw e;
    }
    const taskId = task.rows[0].id as string;
    for (let i = 0; i < input.steps.length; i++) {
      await client.query(`INSERT INTO zenithjoy.worker_task_steps (task_id, step_index, title) VALUES ($1, $2, $3)`, [taskId, i, input.steps[i]]);
    }
    await client.query('COMMIT');
    return { task_id: taskId, lease_until: task.rows[0].lease_until as string };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally { client.release(); }
}

async function loadRunning(taskId: string, executorId: string) {
  const r = await pool.query(`SELECT id, tenant_id, status, executor_id, steps_total FROM zenithjoy.worker_tasks WHERE id = $1`, [taskId]);
  if (r.rows.length === 0) throw new WorkerTaskError('TASK_NOT_FOUND', '任务不存在', 404);
  const t = r.rows[0];
  if (t.status !== 'running') throw new WorkerTaskError('TASK_NOT_RUNNING', '任务已结束，执行器必须停手', 409);
  if (t.executor_id !== executorId) throw new WorkerTaskError('EXECUTOR_MISMATCH', '租约不属于该执行器', 409);
  return { id: t.id as string, tenant_id: t.tenant_id as string, steps_total: Number(t.steps_total ?? 0) };
}

export async function reportStep(taskId: string, r: StepReport) {
  validateStepReport(r);
  const t = await loadRunning(taskId, r.executor_id);
  // 越界的 step_index 在 worker_task_steps 里没有对应行，UPDATE 会静默 0 行、只续租——执行器以为报上了其实没有。
  if (r.step_index >= t.steps_total) {
    throw new WorkerTaskError('STEP_OUT_OF_RANGE', `step_index 须 < steps_total（${t.steps_total}）`, 400);
  }
  const ref = r.screenshot_jpeg_b64 ? await saveShot(t.tenant_id, taskId, r.step_index, r.screenshot_jpeg_b64) : null;
  await pool.query(
    `UPDATE zenithjoy.worker_task_steps SET status = $3, screenshot_ref = COALESCE($4, screenshot_ref),
        foreground_pkg = $5, diag_line = $6, note = $7, updated_at = NOW()
      WHERE task_id = $1 AND step_index = $2`,
    [taskId, r.step_index, r.status, ref, r.foreground_pkg ?? null, r.diag_line ?? null, r.note ?? null],
  );
  await pool.query(
    `UPDATE zenithjoy.worker_tasks SET current_step = GREATEST(current_step, $2),
        lease_until = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW()
      WHERE id = $1`,
    [taskId, r.step_index + 1, String(LEASE_MS)],
  );
  return { ok: true, screenshot_ref: ref };
}

export async function completeTask(taskId: string, body: {
  outcome: Outcome; executor_id: string; evidence?: Record<string, unknown>; error_code?: string; failed_step?: number;
}) {
  if (!['completed', 'failed', 'needs_review'].includes(body.outcome) || !body.executor_id) {
    throw new WorkerTaskError('INVALID_OUTCOME', 'outcome ∈ completed|failed|needs_review，executor_id 必填', 400);
  }
  if (body.outcome === 'failed' && (!body.error_code || !Number.isInteger(body.failed_step))) {
    throw new WorkerTaskError('FAILURE_DETAIL_REQUIRED', 'failed 必带 error_code + failed_step', 400);
  }
  const t = await loadRunning(taskId, body.executor_id);
  let evidence = body.evidence ?? null;
  if (evidence && typeof evidence.screenshot_jpeg_b64 === 'string') {
    assertShotSize(evidence.screenshot_jpeg_b64 as string);
    const ref = await saveShot(t.tenant_id, taskId, 9999, evidence.screenshot_jpeg_b64 as string);
    evidence = { ...evidence, screenshot_ref: ref, screenshot_jpeg_b64: undefined };
  }
  await pool.query(
    `UPDATE zenithjoy.worker_tasks SET status = $2, finished_at = NOW(), error_code = $3, failed_step = $4,
        evidence = $5, updated_at = NOW() WHERE id = $1`,
    [taskId, body.outcome, body.error_code ?? null, body.failed_step ?? null, evidence ? JSON.stringify(evidence) : null],
  );
  return { ok: true };
}

export async function sweepExpiredLeases(): Promise<number> {
  const r = await pool.query(
    `UPDATE zenithjoy.worker_tasks SET status = 'failed', error_code = 'executor_lost', finished_at = NOW(), updated_at = NOW()
      WHERE status = 'running' AND lease_until < NOW() RETURNING id`,
  );
  return r.rowCount ?? 0;
}

/** 读面：本租户 worker 列表 + 运行中任务摘要 + 今日完成数（在线判据与 agent-machines 统一口径） */
export async function listWorkers(tenantId: string) {
  const r = await pool.query(
    `SELECT a.id, a.agent_id, a.hostname, a.nickname, a.machine_role, a.os_type, a.owner_type, a.version, a.last_seen,
            CASE WHEN ${ONLINE_WINDOW_SQL} THEN 'online' ELSE 'offline' END AS status,
            rt.id AS running_task_id, rt.title AS running_title, rt.current_step, rt.steps_total,
            (SELECT COUNT(*) FROM zenithjoy.worker_tasks d WHERE d.agent_id = a.id AND d.status = 'completed'
               AND d.finished_at >= date_trunc('day', NOW())) AS completed_today
       FROM zenithjoy.agents a
       LEFT JOIN zenithjoy.worker_tasks rt ON rt.agent_id = a.id AND rt.status = 'running'
      WHERE a.tenant_id = $1
      ORDER BY (${ONLINE_WINDOW_SQL}) DESC, a.hostname ASC`,
    [tenantId],
  );
  return r.rows;
}

/** 读面：某 worker 当前任务 + 步骤 + 历史 20 条；跨租户返回 null */
export async function getActivity(tenantId: string, agentId: string) {
  const a = await pool.query(`SELECT id FROM zenithjoy.agents WHERE id = $1 AND tenant_id = $2`, [agentId, tenantId]);
  if (a.rows.length === 0) return null;
  const cur = await pool.query(
    `SELECT id, title, executor_id, status, steps_total, current_step, started_at, lease_until
       FROM zenithjoy.worker_tasks WHERE agent_id = $1 AND status = 'running' LIMIT 1`, [agentId]);
  const current = cur.rows[0] ?? null;
  const steps = current
    ? (await pool.query(`SELECT step_index, title, status, screenshot_ref, foreground_pkg, diag_line, note, updated_at
                           FROM zenithjoy.worker_task_steps WHERE task_id = $1 ORDER BY step_index`, [current.id])).rows
    : [];
  // 历史每条自带失败现场三件套（失败步的 foreground_pkg/diag_line/screenshot_ref，按 task_id + step_index=failed_step 关联）、
  // 完成截图 ref（evidence JSONB 抽出）与耗时——运营看历史时不用再点进去翻。
  const hist = await pool.query<HistoryRow>(
    `SELECT t.id, t.title, t.status, t.steps_total, t.started_at, t.finished_at, t.failed_step, t.error_code,
            t.evidence->>'screenshot_ref' AS evidence_screenshot_ref,
            CASE WHEN t.finished_at IS NOT NULL
                 THEN (EXTRACT(EPOCH FROM (t.finished_at - t.started_at)) * 1000)::bigint END AS duration_ms,
            fs.foreground_pkg AS failed_foreground_pkg, fs.diag_line AS failed_diag_line, fs.screenshot_ref AS failed_screenshot_ref
       FROM zenithjoy.worker_tasks t
       LEFT JOIN zenithjoy.worker_task_steps fs ON fs.task_id = t.id AND fs.step_index = t.failed_step
      WHERE t.agent_id = $1 AND t.status <> 'running'
      ORDER BY t.started_at DESC LIMIT 20`, [agentId]);
  const history = hist.rows.map(({ failed_foreground_pkg, failed_diag_line, failed_screenshot_ref, duration_ms, ...h }) => ({
    ...h,
    duration_ms: duration_ms == null ? null : Number(duration_ms),
    failed_scene: h.failed_step == null
      ? null
      : { foreground_pkg: failed_foreground_pkg ?? null, diag_line: failed_diag_line ?? null, screenshot_ref: failed_screenshot_ref ?? null },
  }));
  return { current, steps, history };
}

interface HistoryRow {
  id: string; title: string; status: string; steps_total: number; started_at: string; finished_at: string | null;
  failed_step: number | null; error_code: string | null; evidence_screenshot_ref: string | null;
  duration_ms: string | number | null;
  failed_foreground_pkg: string | null; failed_diag_line: string | null; failed_screenshot_ref: string | null;
}

export async function agentBelongsToTenant(tenantId: string, agentId: string): Promise<boolean> {
  const a = await pool.query(`SELECT 1 FROM zenithjoy.agents WHERE id = $1 AND tenant_id = $2`, [agentId, tenantId]);
  return a.rows.length > 0;
}
