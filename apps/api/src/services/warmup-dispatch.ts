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
 * operator_nickname = 养号收尾要切回的操作号昵称。中台侧暂无可靠主号昵称源
 * （agent_platform_sessions 无 nickname 列，抖音主号昵称只在设备本地），故自动路径默认空串
 * = agent 不做收尾切号（切到错号比不切更糟）。手动 /warmup/run 可显式传 operator_nickname
 * （staging 真机验证收尾切号用）。待补：主号昵称映射进中台后，这里按 agent 解析真实操作号。
 */
import pool from '../db/connection';

// $1 = tenantId 过滤（null=全租户，供每日 cron）。
const CANDIDATE_SQL = `
  SELECT DISTINCT a.id AS agent_id, a.tenant_id
  FROM zenithjoy.agents a
  JOIN zenithjoy.agent_platform_sessions s
    ON s.agent_id = a.id AND s.role = 'burner' AND s.platform = 'douyin'
   AND s.status = 'active' AND s.device_type = 'android'
  WHERE a.last_heartbeat_at > now() - interval '2 minutes'
    AND ($1::uuid IS NULL OR a.tenant_id = $1::uuid)`;

export async function enqueueWarmupTasks(
  tenantId?: string,
  operatorNickname = '',
): Promise<{ enqueued: number }> {
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
      [c.agent_id, JSON.stringify({ task_type: 'warmup', operator_nickname: operatorNickname || '' }), c.tenant_id],
    );
    enqueued += 1;
  }
  return { enqueued };
}
