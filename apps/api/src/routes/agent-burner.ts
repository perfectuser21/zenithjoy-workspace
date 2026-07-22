/**
 * Path 2 Sprint B-1 WS3 — 中台 burner 路由
 *
 * 6 endpoints:
 *   POST   /api/agent/burner/qr-bind                 派 burner 绑定 task
 *   POST   /api/agent/burner/qr-bind-result          接 Agent 扫码完成回调，写 agent_platform_sessions role='burner'
 *   GET    /api/agent/burner/sessions                列 burner sessions（按 tenant_id）
 *   POST   /api/agent/burner/crawl-comments          派抓评论 task
 *   POST   /api/agent/burner/crawl-comments-result   接 Agent 评论上报，调 lead-writer
 *   GET    /api/agent/burner/crawl-tasks/:task_id    查 crawl task 状态（含 lead_write_status + bitable_url）
 *
 * 6 错码:
 *   MISSING_ACCOUNT_LABEL / RESERVED_ACCOUNT_LABEL / BURNER_ALREADY_BOUND
 *   MISSING_VIDEO_URL / NO_BURNER_SESSION / FEISHU_NOT_BOUND
 */
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { writeDmOutreachStatus, type DmStatus } from '../services/lead-writer';
import { tenantContextOptional } from '../middleware/tenant-context';
import { agentContext } from '../middleware/agent-context';
import { simpleRateLimit } from '../middleware/simple-rate-limit';

// CodeQL js/missing-rate-limiting：/account-scan-result 无 tenantContext（鉴权靠 body.agent_id
// 直接反查），且本次 account_label 语义统一 sprint 大幅改写了该 handler，触发静态分析对
// "改动过的代码"重新计入告警。按 agent_id 限流——真机心跳循环~30s一次、dashboard 手动触发已由
// accountScanTriggerRateLimit（acquisition.ts）单独限流 1次/60s，这里给足并发/连续调用余量。
const accountScanResultRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req) => (req.body && req.body.agent_id) || 'anonymous',
});
import { isDuplicateDmOutreachResult } from '../services/device-platform';

const router = Router();

// 标准 UUID 格式校验——publish_tasks.id 是 UUID 列，用非 UUID 字符串查询会被 Postgres
// 抛 22P02（invalid input syntax for type uuid），这里没有 try/catch 会变成未处理的 rejection
// 导致请求挂死。account-scan-result 的 request_id 有三种来源，只有手动触发(b)是真 UUID，
// 内部定时循环(a)和 DM 补扫(c)都是本地拼的字符串，查库前必须先过这一关。
// 与 walking-skeleton.service.ts / acquisition.ts 等文件的同名常量保持完全一致的写法
// （本仓库对这类小型校验正则的既有约定是各文件本地定义，不做跨文件 import）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERR = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});
const OK = (data: unknown) => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
});

// ── account_label 语义统一（2026-07-22 Path2 安卓信号上报 sprint）──────────
// 根因：qr-bind-result（用户绑号）和 account-scan-result（UIA 扫描）曾各自往
// account_label 塞不同语义的值（用户起的标签名 vs 真实抖音昵称），在
// (agent_id,platform,account_label) 唯一约束下会为同一台设备的同一个账号产生
// 两条独立行——这正是 P0 串台 bug 那批脏数据的更深根因。
// 统一方案：account_label 最终只允许是"UIA 扫描读到的真实昵称"，绑号刚完成、
// 还没有扫描结果时用 pending:<task_id> 占位，等第一次扫描进来后"归一"。

export function resolveBindAccountLabel(input: { task_id: string; payload: Record<string, unknown> }): string {
  return `pending:${input.task_id}`;
}

export type ReconcileAction =
  | { type: 'none' }
  | { type: 'rename'; from: string; to: string }
  | { type: 'delete_pending'; label: string };

export function reconcileAccountLabel(input: {
  agentId: string;
  existingLabels: string[];
  realNickname: string;
}): ReconcileAction {
  const pendingLabel = input.existingLabels.find((l) => l.startsWith('pending:'));
  if (!pendingLabel) return { type: 'none' };
  if (input.existingLabels.includes(input.realNickname)) {
    return { type: 'delete_pending', label: pendingLabel };
  }
  return { type: 'rename', from: pendingLabel, to: input.realNickname };
}

export function computeOfflineDiff(input: {
  previouslyActiveLabels: string[];
  currentlyScannedLabels: string[];
}): string[] {
  const currentSet = new Set(input.currentlyScannedLabels);
  return input.previouslyActiveLabels.filter((label) => !currentSet.has(label));
}

function tenantOf(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) {
    res.status(401).json(ERR('NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）'));
    return null;
  }
  return t;
}

// ── helper: 检查飞书 binding ──
async function getFeishuBinding(tenantId: string) {
  const r = await pool.query(
    `SELECT app_token, table_id_leads
       FROM zenithjoy.tenant_feishu_bindings
      WHERE tenant_id=$1`,
    [tenantId],
  );
  if (!r.rows || r.rows.length === 0) return null;
  const row = r.rows[0];
  if (!row.app_token) return null;
  return row as { app_token: string; table_id_leads: string | null };
}

// ── 1. POST /qr-bind — 派 burner 绑定 task ──
// architecture（2026-05-10 hotfix）：tenantContext + agentContext 自动 resolve
// frontend / lead 自验仅传 { account_label } 即可；body explicit tenant_id/agent_id 仍兼容
router.post('/qr-bind', tenantContextOptional, agentContext, async (req: Request, res: Response) => {
  const { account_label } = req.body || {};
  // middleware 注入或 body 显式（agentContext 内部已处理 body 优先）
  const tenant_id = req.body?.tenant_id || req.tenantId;
  const agent_id = req.body?.agent_id || req.agentId;

  if (!account_label || typeof account_label !== 'string') {
    return res.status(400).json(ERR('MISSING_ACCOUNT_LABEL', 'account_label 必填'));
  }
  if (account_label === 'default') {
    return res
      .status(400)
      .json(ERR('RESERVED_ACCOUNT_LABEL', 'account_label 不能用 default（保留给 Path 1 主号）'));
  }
  if (!tenant_id || !agent_id) {
    return res.status(400).json(ERR('MISSING_ACCOUNT_LABEL', 'tenant_id + agent_id 必填'));
  }

  // 防重复绑：同 (agent_id, account_label) 已 active burner 行 → 400
  const existing = await pool.query(
    `SELECT id FROM zenithjoy.agent_platform_sessions
      WHERE agent_id=$1 AND platform='douyin' AND account_label=$2 AND role='burner' AND status='active'`,
    [agent_id, account_label],
  );
  if (existing.rows.length > 0) {
    return res.status(400).json(
      ERR('BURNER_ALREADY_BOUND', `agent ${agent_id} 已绑定小号 ${account_label}`),
    );
  }

  // 写 publish_tasks 一行
  const r = await pool.query(
    `INSERT INTO zenithjoy.publish_tasks
       (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
     VALUES ($1, 'qr_bind/douyin_burner', 'queued', 'qr_bind/douyin_burner', $2, $3, NOW(), NOW())
     RETURNING id`,
    [agent_id, JSON.stringify({ agent_id, account_label, tenant_id }), tenant_id],
  );

  return res.json(OK({ task_id: r.rows[0].id }));
});

// ── 2. POST /qr-bind-result — Agent 扫码完成回调 ──
router.post('/qr-bind-result', async (req: Request, res: Response) => {
  const { task_id, agent_id, qr_login, cookie_local_path, account_nickname } = req.body || {};
  if (!task_id) return res.status(400).json(ERR('MISSING_TASK_ID', 'task_id 必填'));

  if (qr_login !== 'success') {
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status='failed',
         response = jsonb_build_object('qr_login', $2::text),
         updated_at = NOW()
       WHERE id=$1`,
      [task_id, qr_login || 'failed'],
    );
    return res.json(OK({ updated: true, qr_login }));
  }

  // 取 task 拿 account_label + tenant_id
  const t = await pool.query(
    `SELECT payload FROM zenithjoy.publish_tasks WHERE id=$1`,
    [task_id],
  );
  if (t.rows.length === 0) {
    return res.status(404).json(ERR('TASK_NOT_FOUND', 'task_id 未找到'));
  }
  const payload = t.rows[0].payload || {};
  const accountLabel = resolveBindAccountLabel({ task_id: task_id, payload });
  // agent_id 优先取 body，兜底取 task payload（agent 回调时可能未传 body.agent_id）
  const resolvedAgentId = agent_id || payload.agent_id;
  if (!resolvedAgentId) {
    return res.status(400).json(ERR('MISSING_AGENT_ID', 'agent_id 不能为空'));
  }

  // upsert agent_platform_sessions role='burner' status='active'
  await pool.query(
    `INSERT INTO zenithjoy.agent_platform_sessions
       (agent_id, platform, account_label, role, status, bound_at, created_at)
     VALUES ($1, 'douyin', $2, 'burner', 'active', NOW(), NOW())
     ON CONFLICT (agent_id, platform, account_label) DO UPDATE
       SET role='burner', status='active', bound_at=NOW()`,
    [resolvedAgentId, accountLabel],
  );

  // task done + response
  await pool.query(
    `UPDATE zenithjoy.publish_tasks SET status='done',
       response = jsonb_build_object(
         'qr_login', 'success',
         'cookie_local_path', $2::text,
         'account_nickname', $3::text
       ),
       updated_at = NOW()
     WHERE id=$1`,
    [task_id, cookie_local_path || '', account_nickname || ''],
  );

  return res.json(OK({ task_id, sessions_updated: 1 }));
});

// ── FR-1b. POST /uia-signal — UIA 在线状态写入（x-agent-id 反查 tenant）──
// Android agent 通过 x-agent-id header 上报 UIAutomator 探测到的小号在线状态。
// 写入 agent_platform_sessions 的 uia_online / uia_checked_at / uia_error 列。
router.post('/uia-signal', async (req: Request, res: Response) => {
  const xAgentId = req.header('x-agent-id') ?? '';
  if (!xAgentId) return res.status(401).json(ERR('MISSING_AGENT_ID', '缺 x-agent-id header'));

  // 用 x-agent-id 反查 tenant_id（同 acquisition.ts 等路由的做法）
  const agentRes = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM zenithjoy.agents WHERE agent_id = $1 OR id::text = $1 LIMIT 1`,
    [xAgentId],
  );
  const tenantId = agentRes.rows[0]?.tenant_id ?? null;
  if (!tenantId) return res.status(401).json(ERR('UNKNOWN_AGENT', 'agent 未注册'));

  const { account_label, uia_online, uia_error } = req.body || {};
  if (!account_label || typeof account_label !== 'string') {
    return res.status(400).json(ERR('MISSING_ACCOUNT_LABEL', 'account_label 必填'));
  }
  if (typeof uia_online !== 'boolean') {
    return res.status(400).json(ERR('MISSING_UIA_ONLINE', 'uia_online 必填（boolean）'));
  }

  // 校验 account_label 是否存在（对应 tenant 下、douyin 平台）
  const sessionCheck = await pool.query(
    `SELECT 1 FROM zenithjoy.agent_platform_sessions
      WHERE agent_id = $1 AND platform = 'douyin' AND account_label = $2 LIMIT 1`,
    [xAgentId, account_label],
  );
  if (sessionCheck.rows.length === 0) {
    return res.status(404).json(ERR('SESSION_NOT_FOUND', `account_label='${account_label}' 不存在`));
  }

  // 写入 UIA 信号字段；uia_online=false 时同步将 status='offline'
  const safeUiaError = typeof uia_error === 'string' ? uia_error : null;
  if (uia_online === false) {
    await pool.query(
      `UPDATE zenithjoy.agent_platform_sessions
          SET uia_online = $3, uia_checked_at = NOW(), uia_error = $4,
              status = 'offline', updated_at = NOW()
        WHERE agent_id = $1 AND platform = 'douyin' AND account_label = $2`,
      [xAgentId, account_label, uia_online, safeUiaError],
    );
  } else {
    await pool.query(
      `UPDATE zenithjoy.agent_platform_sessions
          SET uia_online = $3, uia_checked_at = NOW(), uia_error = $4,
              updated_at = NOW()
        WHERE agent_id = $1 AND platform = 'douyin' AND account_label = $2`,
      [xAgentId, account_label, uia_online, safeUiaError],
    );
  }

  console.log(`[uia-signal] agent=${xAgentId} account_label=${account_label} uia_online=${uia_online}`);
  return res.json(OK({ account_label, uia_online, updated: true }));
});

// ── 3. GET /sessions — 列 burner sessions（从 session 解析 tenant，不信 query 占位）──
// FR-1c: 增加 computed_online_status 三级判定 + heartbeat_online / uia_online / uia_checked_at / uia_error
router.get('/sessions', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT s.account_label, s.role, s.status, s.bound_at,
              s.device_type,
              s.created_at, s.agent_id,
              s.uia_online, s.uia_checked_at, s.uia_error,
              a.hostname AS agent_hostname,
              a.nickname AS agent_nickname,
              a.status AS agent_status,
              a.last_heartbeat_at,
              (a.last_heartbeat_at >= NOW() - INTERVAL '2 minutes') AS heartbeat_online,
              (SELECT response->>'account_nickname'
                 FROM zenithjoy.publish_tasks
                WHERE agent_id=s.agent_id
                  AND task_type='qr_bind/douyin_burner'
                  AND payload->>'account_label' = s.account_label
                ORDER BY created_at DESC LIMIT 1) AS account_nickname
         FROM zenithjoy.agent_platform_sessions s
         LEFT JOIN zenithjoy.agents a ON a.id = s.agent_id
        WHERE s.agent_id IN (
              SELECT id FROM zenithjoy.agents WHERE tenant_id=$1
            )
          AND s.role='burner'
          AND s.platform='douyin'
        ORDER BY s.created_at DESC`,
      [tenantId],
    );

    // 叠加 computed_online_status 三级判定（JS 层计算，与 FR-5 signal-verify SQL 逻辑一致）
    const sessions = r.rows.map((s) => {
      const heartbeatOnline = s.heartbeat_online === true;
      let computedOnlineStatus: 'online' | 'offline' | 'unknown';
      if (!heartbeatOnline) {
        computedOnlineStatus = 'offline';
      } else if (s.uia_online === false) {
        computedOnlineStatus = 'offline';
      } else if (s.uia_online === true) {
        computedOnlineStatus = 'online';
      } else if (s.uia_error !== null) {
        computedOnlineStatus = 'unknown';
      } else {
        // uia_online IS NULL
        computedOnlineStatus = 'unknown';
      }
      return {
        ...s,
        heartbeat_online: heartbeatOnline,
        computed_online_status: computedOnlineStatus,
      };
    });

    return res.json(OK({ sessions }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[burner/sessions] query failed:', msg);
    return res.status(500).json(ERR('SESSIONS_QUERY_FAILED', msg));
  }
});

// ── 3b. POST /sessions/invalidate — Agent 上报 session 过期，标记 needs_rebind ──
router.post('/sessions/invalidate', agentContext, async (req: Request, res: Response) => {
  const agent_id = req.agentId;
  if (!agent_id) {
    return res.status(401).json(ERR('NO_AGENT', '缺 agent 上下文'));
  }
  const reason = req.body?.reason || 'UNKNOWN';
  try {
    const r = await pool.query(
      `UPDATE zenithjoy.agent_platform_sessions
          SET status = 'needs_rebind', updated_at = NOW()
        WHERE agent_id = $1 AND platform = 'douyin' AND role = 'burner' AND status = 'active'
        RETURNING account_label`,
      [agent_id],
    );
    console.log(`[burner/sessions/invalidate] agent=${agent_id} reason=${reason} updated=${r.rows.length}`);
    return res.json(OK({ invalidated: r.rows.length, reason }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json(ERR('INVALIDATE_FAILED', msg));
  }
});

// ── 4. POST /crawl-comments — 派抓评论 task ──
// architecture（2026-05-10 hotfix）：同 qr-bind，tenantContext + agentContext 自动 resolve
router.post('/crawl-comments', tenantContextOptional, agentContext, async (req: Request, res: Response) => {
  const { account_label, video_url } = req.body || {};
  const tenant_id = req.body?.tenant_id || req.tenantId;
  const agent_id = req.body?.agent_id || req.agentId;

  if (!video_url || typeof video_url !== 'string') {
    return res.status(400).json(ERR('MISSING_VIDEO_URL', 'video_url 必填'));
  }
  if (!tenant_id || !agent_id || !account_label) {
    return res
      .status(400)
      .json(ERR('MISSING_VIDEO_URL', 'tenant_id + agent_id + account_label 必填'));
  }

  // 校验 burner session 存在 + active
  const s = await pool.query(
    `SELECT 1 FROM zenithjoy.agent_platform_sessions
      WHERE agent_id=$1 AND platform='douyin' AND account_label=$2 AND role='burner' AND status='active'`,
    [agent_id, account_label],
  );
  if (s.rows.length === 0) {
    return res
      .status(400)
      .json(ERR('NO_BURNER_SESSION', `agent ${agent_id} 无 active burner session for ${account_label}`));
  }

  const r = await pool.query(
    `INSERT INTO zenithjoy.publish_tasks
       (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
     VALUES ($1, 'crawl_comments/douyin', 'queued', 'crawl_comments/douyin', $2, $3, NOW(), NOW())
     RETURNING id`,
    [
      agent_id,
      JSON.stringify({ agent_id, account_label, video_url, tenant_id }),
      tenant_id,
    ],
  );

  return res.json(OK({ task_id: r.rows[0].id }));
});

// ── 5. POST /crawl-comments-result — Agent 评论上报 → 调 lead-writer ──
router.post('/crawl-comments-result', async (req: Request, res: Response) => {
  const { task_id, video_url, comments, error_code } = req.body || {};
  if (!task_id) return res.status(400).json(ERR('MISSING_TASK_ID', 'task_id 必填'));

  // R4 burner session expired 上报 → task failed
  if (error_code) {
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status='failed',
         response = jsonb_build_object('error_code', $2::text, 'comment_count', 0),
         updated_at = NOW()
       WHERE id=$1`,
      [task_id, error_code],
    );
    return res.json(OK({ updated: true, error_code }));
  }

  const t = await pool.query(
    `SELECT tenant_id, payload FROM zenithjoy.publish_tasks WHERE id=$1`,
    [task_id],
  );
  if (t.rows.length === 0) {
    return res.status(404).json(ERR('TASK_NOT_FOUND', 'task_id 未找到'));
  }
  const tenantId = t.rows[0].tenant_id;
  const payload = (t.rows[0].payload || {}) as Record<string, string | undefined>;
  const safeComments = Array.isArray(comments) ? comments : [];
  const safeVideoUrl = video_url || payload.video_url || '';

  // 写本地 acquisition_leads（不走飞书）
  let insertedCount = 0;
  for (const c of safeComments) {
    const rawId = String(c.commenter_id || '').trim();
    // commenter_id 可能是 "/user/SEC_UID" 路径或昵称文本
    const secUidMatch = rawId.match(/\/user\/([^/?#]+)/);
    const secUid = secUidMatch ? secUidMatch[1] : null;
    const nickname = rawId || '未知';
    const profileUrl = secUid ? `https://www.douyin.com/user/${secUid}` : null;
    try {
      await pool.query(
        `INSERT INTO zenithjoy.acquisition_leads
           (tenant_id, sec_uid, nickname, profile_url, source_video_ids, comment_text, grade, keyword, feishu_write_status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'local_only')
         ON CONFLICT DO NOTHING`,
        [
          tenantId,
          secUid,
          nickname,
          profileUrl,
          JSON.stringify([safeVideoUrl]),
          String(c.text || '').trim() || null,
          c.grade || null,
          c.keyword || null,
        ],
      );
      insertedCount++;
    } catch {
      // 单条失败不中断
    }
  }

  await pool.query(
    `UPDATE zenithjoy.publish_tasks SET status='done',
       response = jsonb_build_object(
         'comment_count', $2::int,
         'lead_write_status', 'local_only',
         'video_url', $3::text
       ),
       updated_at = NOW()
     WHERE id=$1`,
    [task_id, safeComments.length, safeVideoUrl],
  );

  return res.json(
    OK({
      task_id,
      comment_count: safeComments.length,
      inserted: insertedCount,
      lead_write_status: 'local_only',
    }),
  );
});

// ── 6a. GET /crawl-tasks/latest — 查最近一次 crawl task 状态（dashboard 自动恢复用）──
//     必须在 /:task_id 之前注册（Express 顺序匹配）
//     从 session 解析 tenant，不信 query 占位
router.get('/crawl-tasks/latest', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT id, status, response, created_at, updated_at
         FROM zenithjoy.publish_tasks
        WHERE task_type='crawl_comments/douyin' AND tenant_id=$1
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json(ERR('NO_CRAWL_TASK', '暂无 crawl task'));
    }
    const row = r.rows[0];
    const resp = row.response || {};
    return res.json(
      OK({
        task_id: row.id,
        status: row.status,
        comment_count: resp.comment_count ?? 0,
        lead_write_status: resp.lead_write_status,
        feishu_bitable_url: resp.feishu_bitable_url,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[burner/crawl-tasks/latest] query failed:', msg);
    return res.status(500).json(ERR('CRAWL_LATEST_QUERY_FAILED', msg));
  }
});

// ── 6b. GET /crawl-tasks/:task_id — 查 crawl task 状态 ──
router.get('/crawl-tasks/:task_id', async (req: Request, res: Response) => {
  const taskId = req.params.task_id;
  const r = await pool.query(
    `SELECT id, status, response, created_at, updated_at
       FROM zenithjoy.publish_tasks
      WHERE id=$1`,
    [taskId],
  );
  if (r.rows.length === 0) {
    return res.status(404).json(ERR('TASK_NOT_FOUND', 'task_id 未找到'));
  }
  const row = r.rows[0];
  const resp = row.response || {};
  return res.json(
    OK({
      task_id: row.id,
      status: row.status,
      comment_count: resp.comment_count ?? 0,
      lead_write_status: resp.lead_write_status,
      feishu_bitable_url: resp.feishu_bitable_url,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════
//  Path 2 抖音私信主动触达（dm_outreach）— 派单 / 回报 / 查状态
//  task_type='dm_outreach' / platform='douyin'（与既有合并写法不同，按合同分列）
// ════════════════════════════════════════════════════════════════════════

const DM_SESSION_KILLERS = ['SESSION_EXPIRED', 'RISK'];

// ── 7. POST /dm-outreach — 派私信触达单 ──
router.post('/dm-outreach', tenantContextOptional, agentContext, async (req: Request, res: Response) => {
  const { account_label, profile_url, message } = req.body || {};
  const tenant_id = req.body?.tenant_id || req.tenantId;
  const agent_id = req.body?.agent_id || req.agentId;

  // 派单守卫（缺守卫则脏单流到真机）
  if (!profile_url || typeof profile_url !== 'string') {
    return res.status(400).json(ERR('MISSING_PROFILE_URL', 'profile_url 必填'));
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json(ERR('MISSING_MESSAGE', 'message 必填'));
  }
  if (!tenant_id || !agent_id || !account_label) {
    return res
      .status(400)
      .json(ERR('NO_BURNER_SESSION', 'tenant_id + agent_id + account_label 必填'));
  }

  // 必须有 active burner session（不能拿主号去私信）
  const s = await pool.query(
    `SELECT 1 FROM zenithjoy.agent_platform_sessions
      WHERE agent_id=$1 AND platform='douyin' AND account_label=$2 AND role='burner' AND status='active'`,
    [agent_id, account_label],
  );
  if (s.rows.length === 0) {
    return res
      .status(400)
      .json(ERR('NO_BURNER_SESSION', `agent ${agent_id} 无 active burner session for ${account_label}`));
  }

  // tenant 必须绑飞书（结果要回写 Lead 表）
  const binding = await getFeishuBinding(tenant_id);
  if (!binding || !binding.table_id_leads) {
    return res.status(400).json(ERR('FEISHU_NOT_BOUND', 'tenant 未绑飞书，无法回写 Lead 表'));
  }

  const r = await pool.query(
    `INSERT INTO zenithjoy.publish_tasks
       (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
     VALUES ($1, 'douyin', 'queued', 'dm_outreach', $2, $3, NOW(), NOW())
     RETURNING id`,
    [
      agent_id,
      JSON.stringify({ agent_id, account_label, profile_url, message, tenant_id, task_type: 'dm_outreach' }),
      tenant_id,
    ],
  );

  return res.json(OK({ task_id: r.rows[0].id }));
});

// ── 8. POST /dm-outreach-result — Agent 回报触达结果 → 写飞书 + 单号停用不连坐 ──
router.post('/dm-outreach-result', async (req: Request, res: Response) => {
  const {
    task_id,
    agent_id,
    account_label,
    status,
    error_code,
    profile_url,
    screenshot_path,
    device_platform,
    dm_assignment_id,
  } = req.body || {};
  if (!task_id) return res.status(400).json(ERR('MISSING_TASK_ID', 'task_id 必填'));

  const t = await pool.query(
    `SELECT tenant_id, payload FROM zenithjoy.publish_tasks WHERE id=$1`,
    [task_id],
  );
  if (t.rows.length === 0) {
    return res.status(404).json(ERR('TASK_NOT_FOUND', 'task_id 未找到'));
  }
  const tenantId = t.rows[0].tenant_id;
  const payload = (t.rows[0].payload || {}) as Record<string, string | undefined>;
  const acctLabel = account_label || payload.account_label || '';
  const agentId = agent_id || payload.agent_id || '';
  const profileUrl = profile_url || payload.profile_url || '';
  const assignmentId: string | null = dm_assignment_id || payload.dm_assignment_id || null;
  const dmStatus: DmStatus =
    status === 'sent' || status === 'limited' || status === 'failed' ? status : 'failed';

  // 幂等判定（Reviewer 幂等断言加固）：按 dm_assignment_id 查 dm_assignments 当前状态，
  // 已是终态(sent/limited/failed) → 本次视为重复回传，不再计数/不再触发飞书写入/不再改状态。
  let isDuplicate = false;
  if (assignmentId) {
    const assignRes = await pool.query(
      `SELECT status FROM zenithjoy.dm_assignments WHERE id=$1`,
      [assignmentId],
    );
    const currentAssignmentStatus: string | null = assignRes.rows[0]?.status ?? null;
    isDuplicate = isDuplicateDmOutreachResult(currentAssignmentStatus);
  }

  const binding = await getFeishuBinding(tenantId);
  const feishuBitableUrl = binding?.app_token ? `https://feishu.cn/base/${binding.app_token}` : '';

  // failed + SESSION_EXPIRED/RISK → 仅停用「被触达的那个号」（不连坐同 agent 其他号）
  let sessionDisabled = false;
  if (!isDuplicate && dmStatus === 'failed' && error_code && DM_SESSION_KILLERS.includes(error_code)) {
    const upd = await pool.query(
      // agent_platform_sessions 无 updated_at 列（只 bound_at/created_at）— 不可写 updated_at
      `UPDATE zenithjoy.agent_platform_sessions SET status='expired'
        WHERE agent_id=$1 AND platform='douyin' AND account_label=$2 AND role='burner'`,
      [agentId, acctLabel],
    );
    sessionDisabled = (upd.rowCount ?? 0) > 0;
  }

  // 飞书 Lead 表回写触达状态（重复回传不再写，避免飞书写入计数翻倍）
  let leadWriteStatus: 'success' | 'failed' = 'failed';
  if (!isDuplicate && binding?.table_id_leads) {
    const w = await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: binding.table_id_leads,
      profile_url: profileUrl,
      account_label: acctLabel,
      dm_status: dmStatus,
      error_code: error_code || null,
    });
    leadWriteStatus = w.lead_write_status;
  }

  if (!isDuplicate) {
    // 更新 task 终态：sent/limited→done，failed→failed
    const taskStatus = dmStatus === 'failed' ? 'failed' : 'done';
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status=$2,
         response = jsonb_build_object(
           'dm_status', $3::text,
           'error_code', $4::text,
           'feishu_bitable_url', $5::text,
           'profile_url', $6::text,
           'account_label', $7::text,
           'lead_write_status', $8::text,
           'screenshot_path', $9::text
         ),
         updated_at = NOW()
       WHERE id=$1`,
      [
        task_id,
        taskStatus,
        dmStatus,
        error_code || null,
        feishuBitableUrl,
        profileUrl,
        acctLabel,
        leadWriteStatus,
        screenshot_path || '',
      ],
    );

    // dm_assignment_id 存在时：把 dm_outreach_log 的对应行(assignment_id 关联)从 dispatched
    // 推进到真实终态 + 同步 dm_assignments.status（幂等去重键，重复回传被上面 isDuplicate 短路）
    if (assignmentId) {
      await pool.query(
        `UPDATE zenithjoy.dm_outreach_log SET status=$2
           WHERE assignment_id=$1`,
        [assignmentId, dmStatus],
      );
      await pool.query(
        `UPDATE zenithjoy.dm_assignments SET status=$2, updated_at=now() WHERE id=$1`,
        [assignmentId, dmStatus],
      );
    }
  }

  const data: Record<string, unknown> = {
    task_id,
    status: dmStatus,
    lead_write_status: leadWriteStatus,
    feishu_bitable_url: feishuBitableUrl,
  };
  // session_disabled 仅 failed 分支附带（sent/limited schema 不含此字段）
  if (dmStatus === 'failed') {
    data.session_disabled = sessionDisabled;
  }
  // device_platform 仅当请求带了该字段才回显（保持与既有 sent/limited/failed 三态 schema 向后兼容）
  if (device_platform !== undefined) {
    data.device_platform = device_platform;
  }

  return res.json(OK(data));
});

// ── 9. GET /dm-tasks/:task_id — 查触达单状态（运营在飞书看到的终态代理）──
router.get('/dm-tasks/:task_id', async (req: Request, res: Response) => {
  const taskId = req.params.task_id;
  const r = await pool.query(
    `SELECT id, status, response, created_at, updated_at
       FROM zenithjoy.publish_tasks
      WHERE id=$1 AND task_type='dm_outreach'`,
    [taskId],
  );
  if (r.rows.length === 0) {
    return res.status(404).json(ERR('NO_DM_TASK', 'dm task 未找到'));
  }
  const row = r.rows[0];
  const resp = row.response || {};
  return res.json(
    OK({
      task_id: row.id,
      status: row.status,
      dm_status: resp.dm_status ?? null,
      error_code: resp.error_code ?? null,
      feishu_bitable_url: resp.feishu_bitable_url ?? null,
      profile_url: resp.profile_url ?? null,
      account_label: resp.account_label ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  );
});

// ── account-scan-result — Line02 Step7 账号扫描结果写回（手机端 DeviceAccountScanService）──
// 扫描到的抖音账号昵称 upsert 进 agent_platform_sessions(role='burner')，让"账号管理"页
// (GET /sessions 同表)能看到手机上已登录的小号，跟 qr-bind-result 写同一张表。
//
// bugfix（cp-0720073537）：闭环 publish_tasks。account_scan 有两个触发源：
//   (a) 手机内部 30-60min 定时循环（runAccountScanLoop）——本地生成 requestId
//       "scan-<ts>"，从未写入 publish_tasks，查无该行是正常情况，必须跳过 update、
//       不能 404，否则会打断这条一直工作正常的既有上报流程；
//   (b) Dashboard 手动触发（POST /account-scan/trigger）——真实 publish_tasks 行存在，
//       必须在这里推进到终态，否则 getQueuedTasks()（status IN pending/queued/dispatched，
//       无完成过滤）会把同一行永远当"待处理"重复下发，手机每次心跳(~30s)重扫一次账号，
//       无限循环，battery drain + 抖音风控风险。
// 幂等：镜像 /warmup-result 的模式——已终态(done/failed)的行直接短路，不重复写。
router.post('/account-scan-result', accountScanResultRateLimit, async (req: Request, res: Response) => {
  const { agent_id, request_id, ok, account_ids, error_code, screenshot_b64, tree_dump } = req.body || {};
  if (!agent_id || typeof agent_id !== 'string') {
    return res.status(400).json(ERR('MISSING_AGENT_ID', 'agent_id 必填'));
  }

  let taskFound = false;
  // 只有格式合法的 UUID 才值得查 publish_tasks——id 是 UUID 列，非 UUID 字符串（内部定时
  // 循环的 "scan-<base36>"、DM 补扫的 "rescan-<task_id>"）直接查会被 Postgres 抛 22P02，
  // 这里没有 try/catch，未处理的 rejection 会让请求挂死，永远到不了下面的 session 写入。
  if (request_id && typeof request_id === 'string' && UUID_RE.test(request_id)) {
    const t = await pool.query(
      `SELECT status FROM zenithjoy.publish_tasks WHERE id=$1`,
      [request_id],
    );
    if (t.rows.length > 0) {
      taskFound = true;
      const curStatus: string = t.rows[0].status;
      // 幂等：已终态 → 短路（防重复回传重复写库），行为镜像 /warmup-result
      if (curStatus === 'done' || curStatus === 'failed') {
        return res.json(OK({ idempotent: true }));
      }
    }
    // 查无该行（UUID 格式合法但 publish_tasks 里没有）→ 属正常情况，继续走下面的
    // agent_platform_sessions 写入，不 404、不报错。
  }
  // request_id 不是 UUID 格式（内部定时循环 / DM 补扫场景）→ 跳过 publish_tasks 查询与
  // 更新，直接走下面的 agent_platform_sessions 写入，不 404、不报错。

  const ids = Array.isArray(account_ids) ? account_ids.filter((x) => typeof x === 'string' && x) : [];
  let written = 0;
  // 差集标离线必须在 ok===true 时无条件跑（即使 ids 为空——本轮扫描一个账号都没扫到，
  // 例如设备上所有小号都被登出，这正是"该标离线"的场景）。只在 ok=false（扫描本身失败）
  // 时整体跳过——此时没有真实的"当前扫描结果"，不能拿空列表去把所有账号错误地标离线。
  if (ok === true) {
    // 归一 + 差集共用同一份"当前库内状态"快照：这条 SELECT 必须在下面的归一/insert
    // 写入循环之前执行——computeOfflineDiff 需要看到"本次扫描写入之前"的 active 状态，
    // 不是写入之后的。若被挪到写入循环之后，本轮扫描到的账号早已被写成 active，
    // 差集会永远算不出任何离线账号。
    const existingRes = await pool.query(
      `SELECT account_label, status FROM zenithjoy.agent_platform_sessions
        WHERE agent_id = $1 AND platform = 'douyin' AND role = 'burner'`,
      [agent_id],
    );
    const existingLabels: string[] = existingRes.rows.map((r) => r.account_label);
    const previouslyActiveLabels: string[] = existingRes.rows
      .filter((r) => r.status === 'active')
      .map((r) => r.account_label);

    if (ids.length > 0) {
      // 归一：把该 agent 下的 pending 占位行归一到这次扫描到的真实昵称
      for (const nickname of ids) {
        const action = reconcileAccountLabel({ agentId: agent_id, existingLabels, realNickname: nickname });
        if (action.type === 'rename') {
          await pool.query(
            `UPDATE zenithjoy.agent_platform_sessions
                SET account_label = $3, status = 'active', bound_at = NOW()
              WHERE agent_id = $1 AND platform = 'douyin' AND account_label = $2`,
            [agent_id, action.from, action.to],
          );
        } else if (action.type === 'delete_pending') {
          await pool.query(
            `DELETE FROM zenithjoy.agent_platform_sessions
              WHERE agent_id = $1 AND platform = 'douyin' AND account_label = $2`,
            [agent_id, action.label],
          );
        }
        await pool.query(
          `INSERT INTO zenithjoy.agent_platform_sessions
             (agent_id, platform, account_label, role, status, bound_at, created_at)
           VALUES ($1, 'douyin', $2, 'burner', 'active', NOW(), NOW())
           ON CONFLICT (agent_id, platform, account_label) DO UPDATE
             SET role='burner', status='active', bound_at=NOW()`,
          [agent_id, nickname],
        );
        written += 1;
      }
    }

    // 差集标离线：本次扫描仍是权威真相来源，上次 active 但这次没扫到的账号标 offline。
    // 无条件跑（不受 ids.length>0 限制）——ids 为空时 computeOfflineDiff 会把所有
    // previouslyActiveLabels 判定为离线，这正是"本轮全部登出"场景需要的效果。
    const offlineDiff = computeOfflineDiff({ previouslyActiveLabels, currentlyScannedLabels: ids });
    for (const label of offlineDiff) {
      await pool.query(
        `UPDATE zenithjoy.agent_platform_sessions
            SET status = 'offline'
          WHERE agent_id = $1 AND platform = 'douyin' AND account_label = $2`,
        [agent_id, label],
      );
    }
  }

  // 仅当 request_id 对应真实 publish_tasks 行（手动触发场景）才推进其终态，
  // 关闭 getQueuedTasks() 重复派发的循环。
  if (taskFound) {
    const taskStatus = ok === true ? 'done' : 'failed';
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status=$2, response=$3::jsonb, updated_at=NOW() WHERE id=$1`,
      [
        request_id,
        taskStatus,
        JSON.stringify({
          ok: !!ok,
          account_ids: ids,
          error_code: typeof error_code === 'string' ? error_code : null,
          screenshot_b64: typeof screenshot_b64 === 'string' ? screenshot_b64 : null,
          tree_dump: typeof tree_dump === 'string' ? tree_dump : null,
        }),
      ],
    );
  }

  return res.json(OK({ written }));
});

// ── warmup 验活结果回传（Line02 每日养号）——tenant 服务端按 task_id 反查，幂等按 publish_tasks 状态 ──
router.post('/warmup-result', async (req: Request, res: Response) => {
  const { task_id, device_id, total, alive, offline, results, error_code } = req.body || {};
  if (!task_id) return res.status(400).json(ERR('MISSING_TASK_ID', 'task_id 必填'));
  const t = await pool.query(
    `SELECT tenant_id, status, agent_id FROM zenithjoy.publish_tasks WHERE id=$1`,
    [task_id],
  );
  if (t.rows.length === 0) return res.status(404).json(ERR('TASK_NOT_FOUND', 'task_id 未找到'));
  const curStatus: string = t.rows[0].status;
  const agentId: string = t.rows[0].agent_id;
  // 幂等：已终态 → 短路（防重复回传重复写库）
  if (curStatus === 'done' || curStatus === 'failed') return res.json(OK({ idempotent: true }));

  const errCode: string = typeof error_code === 'string' ? error_code : '';
  const report = { total, alive, offline, results, error_code: errCode };
  const taskStatus = errCode ? 'failed' : 'done';
  // 先写 liveness 再置 task 终态（非事务，但顺序保证可恢复）：若某条 upsert 失败抛错，
  // task 仍为 queued（未 done）→ 幂等不短路，agent 重传可补齐（upsert ON CONFLICT 幂等）。
  // error_code 非空（MUTEX_BUSY/超时/…）→ 保留各号上次状态，不 upsert（不误判掉线）。
  let written = 0;
  if (!errCode && Array.isArray(results)) {
    for (const r of results) {
      if (!r || typeof r.nickname !== 'string' || !r.nickname) continue;
      // followers 强制整数或 null——防脏数据（非数字）触发 integer 列写入报错、破坏本次回传。
      const followers =
        typeof r.followers === 'number' && Number.isFinite(r.followers) ? Math.trunc(r.followers) : null;
      await pool.query(
        `INSERT INTO zenithjoy.agent_warmup_liveness (agent_id, device_id, nickname, alive, followers, reason, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (agent_id, nickname) DO UPDATE
           SET alive=EXCLUDED.alive, followers=EXCLUDED.followers, reason=EXCLUDED.reason,
               device_id=EXCLUDED.device_id, checked_at=now()`,
        [agentId, device_id ?? null, r.nickname, !!r.alive,
         followers, (typeof r.reason === 'string' ? r.reason : null)],
      );
      written += 1;
    }
  }
  await pool.query(
    `UPDATE zenithjoy.publish_tasks SET status=$2, response=$3::jsonb, updated_at=NOW() WHERE id=$1`,
    [task_id, taskStatus, JSON.stringify(report)],
  );
  return res.json(OK({ task_status: taskStatus, written }));
});

// ── warmup 验活状态查询（dashboard）——某 agent 最近每号活/掉线 ──
// 租户隔离：只能查本租户名下 agent（JOIN agents 校验归属，防跨租户读小号昵称/粉丝）。
router.get('/warmup-liveness', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const agentId = String(req.query.agent_id || '');
  if (!agentId) return res.status(400).json(ERR('MISSING_AGENT_ID', 'agent_id 必填'));
  const r = await pool.query(
    `SELECT l.nickname, l.alive, l.followers, l.reason, l.checked_at
       FROM zenithjoy.agent_warmup_liveness l
       JOIN zenithjoy.agents a ON a.id = l.agent_id AND a.tenant_id = $2
      WHERE l.agent_id = $1 ORDER BY l.checked_at DESC`,
    [agentId, tenantId],
  );
  return res.json(OK({ liveness: r.rows }));
});

export default router;
export { router as agentBurnerRouter };
