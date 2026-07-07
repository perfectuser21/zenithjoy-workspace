/**
 * Line02 Path2 Step7 —— warmup 每日养号验活下发
 *
 * 候选：有 ≥1 个 active douyin burner session 且 session.device_type='android'、agent 在线
 * （last_heartbeat_at > now-2min）的 agent。每 agent 若已有 warmup task 处于
 * pending/queued/dispatched 或 24h 内 done → 跳过（去重）；否则 INSERT
 * publish_tasks(task_type='warmup', payload={task_type:'warmup', operator_nickname})。
 *
 * 判别符走 payload.task_type（agent 侧照此判别）——getQueuedTasks 只 select publish 类型列
 * `type`，无 task_type 列，故不能靠 heartbeat 的 type 字段区分，必须走 payload。
 *
 * operator_nickname = 该 agent role='main' douyin session 最近 account_nickname（收尾切回的
 * 操作号，取自 publish_tasks.response）；无 main 号则空串（agent 侧空串=不切收尾号）。
 */
import pool from '../db/connection';

// $1 = tenantId 过滤（null=全租户，供每日 cron）。operator_nickname 子查询取该 agent 主号昵称。
const CANDIDATE_SQL = `
  SELECT DISTINCT a.id AS agent_id, a.tenant_id,
    COALESCE((
      SELECT pt.response->>'account_nickname'
        FROM zenithjoy.publish_tasks pt
        JOIN zenithjoy.agent_platform_sessions ms
          ON ms.agent_id = a.id AND ms.role = 'main' AND ms.platform = 'douyin'
       WHERE pt.agent_id = a.id
         AND pt.task_type = 'qr_bind/douyin_burner'
         AND pt.response->>'account_nickname' IS NOT NULL
       ORDER BY pt.created_at DESC LIMIT 1
    ), '') AS operator_nickname
  FROM zenithjoy.agents a
  JOIN zenithjoy.agent_platform_sessions s
    ON s.agent_id = a.id AND s.role = 'burner' AND s.platform = 'douyin'
   AND s.status = 'active' AND s.device_type = 'android'
  WHERE a.last_heartbeat_at > now() - interval '2 minutes'
    AND ($1::uuid IS NULL OR a.tenant_id = $1::uuid)`;

export async function enqueueWarmupTasks(tenantId?: string): Promise<{ enqueued: number }> {
  const cands = await pool.query(CANDIDATE_SQL, [tenantId ?? null]);
  let enqueued = 0;
  for (const c of cands.rows) {
    const dup = await pool.query(
      `SELECT count(*)::int AS n FROM zenithjoy.publish_tasks
        WHERE agent_id = $1 AND task_type = 'warmup'
          AND (status IN ('pending','queued','dispatched') OR updated_at > now() - interval '24 hours')`,
      [c.agent_id],
    );
    if ((dup.rows[0]?.n ?? 0) > 0) continue;
    await pool.query(
      `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
       VALUES ($1, 'douyin', 'queued', 'warmup', $2::jsonb, $3, now(), now())`,
      [c.agent_id, JSON.stringify({ task_type: 'warmup', operator_nickname: c.operator_nickname || '' }), c.tenant_id],
    );
    enqueued += 1;
  }
  return { enqueued };
}
