/**
 * worker_tasks（执行记录，本地库）→ Brain tasks.device_job（计划真身，us-vps）的桥接。
 *
 * 为什么需要：工作机页只读 Brain 的 device_job，而 cron 触发的采收/触达只写本地
 * worker_tasks —— 手机整天在跑，页面却是 0 任务（09-24 实证：13:50 出线索 19/15，页面 0）。
 *
 * 为什么写 Brain 而不是在中台另建表：`db/brain-pool.ts` 的既定用途就是
 * 「只读排程 + 写 device_job 任务单」，决策 e1ec93b2「Brain tasks = 唯一真身」。
 */

/** Brain 侧任务状态（页面 STATUS_MAP 认得的值域） */
export type MirrorStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'blocked';

/**
 * 构造 Brain 单标题。
 *
 * Brain 有 `idx_tasks_dedup_active` = UNIQUE(title, goal_id, project_id)
 * WHERE status IN ('queued','in_progress')。金诺两台同时跑「获客采收·AI人工智能训练师」
 * 时 title 相同 → 第二条 23505 → 被 best-effort 咽掉 → 页面还是 0 条。
 *
 * 所以带上序列号尾 4 位 + 起跑时分。这不是为绕索引而变丑：页面本来就需要
 * 区分哪台手机、哪一批，是信息增益。同机同词同分钟的极端情况用 task id 前 6 位兜底。
 */
export function buildMirrorTitle(title: string, serial: string, startedAt: string, workerTaskId: string): string {
  const tail = String(serial ?? '').slice(-4) || '????';
  const d = new Date(startedAt);
  const hhmm = Number.isFinite(d.getTime())
    ? `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`
    : '0000';
  return `${title} · ${tail} · ${hhmm} · ${String(workerTaskId).slice(0, 6)}`;
}

const STATUS: Record<string, MirrorStatus> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  needs_review: 'blocked',
};

/** 未知状态落 blocked —— 与页面 toScheduleSlot 同款态度：不静默变成"待跑"骗人。 */
export function mapWorkerStatus(s: string): MirrorStatus {
  return STATUS[s] ?? 'blocked';
}

export interface MirrorPayload {
  read_only: true;
  source: 'cron';
  headed_manual: true;
  serial: string;
  idempotency_key: string;
  executed_at: string;
  [k: string]: unknown;
}

/**
 * payload 三道闸，少一道都会出事：
 *  - source='cron'：领单器 /claim 只认 `source='oneoff'`，写错会把"已经在本机跑着的活"
 *    再领走跑第二遍，两个进程抢同一台手机。
 *  - read_only：页面对每条活都给「改时间/取消」按钮，但对镜像行做 CAS 对真机零作用 ——
 *    运营点了取消，手机照跑。写面必须据此拒绝。
 *  - headed_manual：防 Brain tick 把这条活派给 LLM 执行体真去跑一轮采收。
 */
export function buildMirrorPayload(a: { serial: string; workerTaskId: string; startedAt: string }): MirrorPayload {
  return {
    read_only: true,
    source: 'cron',
    headed_manual: true,
    serial: a.serial,
    idempotency_key: a.workerTaskId,
    executed_at: a.startedAt,
  };
}

import { getBrainPool } from '../db/brain-pool';
import localPool from '../db/connection';

async function toOutbox(workerTaskId: string, op: 'create' | 'complete' | 'sweep', payload: unknown, err?: unknown) {
  try {
    await localPool.query(
      `INSERT INTO zenithjoy.brain_sync_outbox (worker_task_id, op, payload, last_error)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [workerTaskId, op, JSON.stringify(payload ?? {}), err instanceof Error ? err.message : err ? String(err) : null],
    );
  } catch (e) {
    // outbox 都写不进就只剩日志了。绝不再往上抛 —— 这是记账的记账。
    console.error('[brain-mirror] outbox 写入失败:', e);
  }
}

/**
 * 在 Brain 建一条 device_job。失败一律吞掉并落 outbox，绝不阻断调用方。
 * 返回 brain task id；没建成返回 null。
 */
export async function createMirrorJob(a: {
  workerTaskId: string; agentId: string; serial: string; title: string; startedAt: string;
}): Promise<string | null> {
  const brain = getBrainPool();
  const payload = buildMirrorPayload({ serial: a.serial, workerTaskId: a.workerTaskId, startedAt: a.startedAt });
  const title = buildMirrorTitle(a.title, a.serial, a.startedAt, a.workerTaskId);
  if (!brain) { await toOutbox(a.workerTaskId, 'create', { ...a, title, payload }); return null; }
  try {
    const r = await brain.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, dept, assigned_to, due_at, payload, trigger_source)
       VALUES ($1, $2, 'device_job', 'in_progress', 'P2', $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [title, `工作机自发活 · ${a.serial}`, '智能获客', a.agentId, a.startedAt, JSON.stringify(payload), 'cron'],
    );
    return (r.rows[0]?.id as string) ?? null;
  } catch (e) {
    await toOutbox(a.workerTaskId, 'create', { ...a, title, payload }, e);
    return null;
  }
}

/** 把 brain task id 记进 worker_tasks.evidence。用 jsonb 合并而非覆盖 —— completeTask
 *  的 `evidence = $5` 是整体覆盖，直接写会被后续收尾抹掉。 */
export async function attachMirrorJob(workerTaskId: string, brainTaskId: string): Promise<void> {
  try {
    await localPool.query(
      `UPDATE zenithjoy.worker_tasks
          SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object('brain_task_id', $2::text),
              updated_at = NOW()
        WHERE id = $1`,
      [workerTaskId, brainTaskId],
    );
  } catch (e) {
    console.error('[brain-mirror] 关联 brain_task_id 失败:', e);
  }
}

/** 回写 Brain 单的终态。失败落 outbox，不抛。 */
export async function completeMirrorJob(
  brainTaskId: string, workerStatus: string, extra?: Record<string, unknown>,
): Promise<void> {
  const brain = getBrainPool();
  const status = mapWorkerStatus(workerStatus);
  if (!brain) { await toOutbox(brainTaskId, 'complete', { brainTaskId, status, extra }); return; }
  try {
    await brain.query(
      // $2 必须显式标 ::text：它同时喂给 status（varchar 列）和 IN ('completed','failed')
      // 的文本比较，不标类型 PG 推不出一致类型，直接报
      // "inconsistent types deduced for parameter $2"。
      // 这条 mock 测试验不出来（pool 被 mock，SQL 文本没人真跑）——0924 上生产后
      // 是 outbox 把它捞出来的，表现为收尾永远不回写、页面停在"执行中"。
      `UPDATE tasks
          SET status = $2::text,
              completed_at = CASE WHEN $2::text IN ('completed','failed') THEN NOW() ELSE completed_at END,
              payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [brainTaskId, status, JSON.stringify({ finished_at: new Date().toISOString(), ...(extra ?? {}) })],
    );
  } catch (e) {
    await toOutbox(brainTaskId, 'complete', { brainTaskId, status, extra }, e);
  }
}
