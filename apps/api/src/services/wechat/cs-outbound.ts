/**
 * cs-outbound.ts — 微信客服「主动发给关键人」出站任务队列（Line 04）。
 *
 * C1 尾巴：把关键人「上下线播报」「失败/掉线告警」从「只拼 payload 上报心跳」推进到
 * 「真机主动发送」——中台把出站任务入库，agent 拉取后调 send_chat.py 真机 UIA 发送、回写回执。
 *
 * 存储复用 zenithjoy.wechat_publish_task（C1 迁移已放开 approval_source='system' + 新状态）：
 *   - task_type          = 'private_chat'（CHECK 仅容 moments/private_chat）
 *   - target_friend_alias= 关键人微信（发送目标）
 *   - content            = 播报/告警文案
 *   - approval_source    = 'system'（AI 无人审，系统直发）
 *   - status             = 'approved'（=待真机发）→ 发送后回执翻 'auto_sent' / 'send_failed'
 *
 * 真机 UIA 发送本身是接缝（xian-rog 真验）；本模块只负责「中台侧任务入库/拉取/回执」可测链路。
 */

import pool from '../../db/connection';

// 上/下线播报文案（与 auto_reply.py ONLINE_TEXT/OFFLINE_TEXT 同语义）。
export const ONLINE_TEXT = '🟢 智能客服已上线，随时待命';
export const OFFLINE_TEXT = '🔴 智能客服已下线，转人工接管';

// 出站任务在库内的「待发」与「终态」状态（落在 wechat_publish_task_status_check 白名单内）。
const STATUS_PENDING_SEND = 'approved'; // approved = 系统已批，待 agent 真机发
const STATUS_SENT = 'auto_sent';
const STATUS_FAILED = 'send_failed';

// 告警去重时间窗（毫秒）。同 (关键人, 原因) 在窗内只入一条，防刷屏。
const ALERT_DEDUP_WINDOW_MS = 5 * 60 * 1000;

export interface BroadcastEnqueueResult {
  action: 'online' | 'offline' | 'skip';
  task_id?: string;
  reason?: string;
}

export interface AlertEnqueueResult {
  task_id?: string;
  deduped?: boolean;
}

export interface OutboundTask {
  task_id: string;
  target: string;
  message: string;
  kind: 'broadcast' | 'alert';
}

/**
 * 入一条出站任务（status=approved 待发，approval_source=system）。返回 task id。
 * DB 失败 → 抛（调用方决定吞不吞；播报路径吞，不阻塞开关保存）。
 */
async function insertOutbound(
  agentId: string,
  keyContact: string,
  content: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO zenithjoy.wechat_publish_task
       (agent_id, task_type, content, target_friend_alias, status, approval_source)
     VALUES ($1, 'private_chat', $2, $3, $4, 'system')
     RETURNING id`,
    [agentId, content, keyContact, STATUS_PENDING_SEND],
  );
  return rows[0].id;
}

/**
 * 开关跳变 → 入关键人上/下线播报出站任务。
 * 真值表（镜像 auto_reply.broadcast_action）：
 *   - 关键人未配（空）→ skip（不入任务、不报错）
 *   - 无跳变（prev==next）→ skip
 *   - OFF→ON → online（入上线任务）；ON→OFF → offline（入下线任务）
 * 入库失败不抛（不阻塞开关保存），返回 skip + reason。
 */
export async function enqueueKeyContactBroadcast(params: {
  prevOn: boolean;
  nextOn: boolean;
  keyContact: string;
  agentId: string;
}): Promise<BroadcastEnqueueResult> {
  const { prevOn, nextOn, keyContact, agentId } = params;
  if (!keyContact) {
    return { action: 'skip', reason: 'key_contact_unconfigured' };
  }
  if (prevOn === nextOn) {
    return { action: 'skip', reason: 'no_change' };
  }
  const action = nextOn ? 'online' : 'offline';
  const content = nextOn ? ONLINE_TEXT : OFFLINE_TEXT;
  try {
    const taskId = await insertOutbound(agentId, keyContact, content);
    return { action, task_id: taskId };
  } catch (err) {
    console.warn('[cs-outbound] 播报出站任务入库失败（不阻塞开关）:', err);
    return { action: 'skip', reason: 'enqueue_failed' };
  }
}

/**
 * 发送失败/掉线 → 入关键人告警出站任务，同 (关键人, 原因) 时间窗内去重（只一条）。
 * 关键人未配 → 不入（task_id 缺省）。
 */
export async function enqueueFailureAlert(params: {
  reason: string;
  keyContact: string;
  agentId: string;
}): Promise<AlertEnqueueResult> {
  const { reason, keyContact, agentId } = params;
  if (!keyContact) return {};

  const alertText = `⚠️ 智能客服异常：${reason}`;
  try {
    // 去重：同 agent + 同关键人 + 同告警文案 在窗口内已有 system 出站任务 → 跳过
    const dup = await pool.query(
      `SELECT 1 FROM zenithjoy.wechat_publish_task
        WHERE agent_id = $1
          AND target_friend_alias = $2
          AND content = $3
          AND approval_source = 'system'
          AND created_at > now() - ($4::int || ' milliseconds')::interval
        LIMIT 1`,
      [agentId, keyContact, alertText, ALERT_DEDUP_WINDOW_MS],
    );
    if (dup.rows.length > 0) {
      return { deduped: true };
    }
    const taskId = await insertOutbound(agentId, keyContact, alertText);
    return { task_id: taskId };
  } catch (err) {
    console.warn('[cs-outbound] 告警出站任务入库失败:', err);
    return {};
  }
}

/** 列出某 agent 的待发出站任务（status=approved + system）。供 agent 轮询拉取。 */
export async function listPendingOutbound(agentId: string): Promise<OutboundTask[]> {
  const { rows } = await pool.query<{
    id: string;
    target_friend_alias: string;
    content: string;
  }>(
    `SELECT id, target_friend_alias, content
       FROM zenithjoy.wechat_publish_task
      WHERE agent_id = $1
        AND task_type = 'private_chat'
        AND approval_source = 'system'
        AND status = $2
      ORDER BY created_at ASC`,
    [agentId, STATUS_PENDING_SEND],
  );
  return rows.map((r) => ({
    task_id: r.id,
    target: r.target_friend_alias,
    message: r.content,
    kind: r.content.startsWith('⚠️') ? 'alert' : 'broadcast',
  }));
}

/**
 * agent 真机发送后回写回执：成功 → auto_sent；失败 → send_failed（不重发）。
 * 返回是否更新到（false = 任务不存在 / 已是终态）。
 */
export async function markOutboundReceipt(
  taskId: string,
  ok: boolean,
): Promise<boolean> {
  const status = ok ? STATUS_SENT : STATUS_FAILED;
  const { rowCount } = await pool.query(
    `UPDATE zenithjoy.wechat_publish_task
        SET status = $2, updated_at = now()
      WHERE id = $1 AND status = $3`,
    [taskId, status, STATUS_PENDING_SEND],
  );
  return (rowCount ?? 0) > 0;
}
