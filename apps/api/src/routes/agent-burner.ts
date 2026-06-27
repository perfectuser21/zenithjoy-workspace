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
import { writeLeadsFromComments, writeDmOutreachStatus, type DmStatus } from '../services/lead-writer';
import { tenantContextOptional } from '../middleware/tenant-context';
import { agentContext } from '../middleware/agent-context';

const router = Router();

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
  const accountLabel = payload.account_label || 'default';

  // upsert agent_platform_sessions role='burner' status='active'
  await pool.query(
    `INSERT INTO zenithjoy.agent_platform_sessions
       (agent_id, platform, account_label, role, status, bound_at, created_at)
     VALUES ($1, 'douyin', $2, 'burner', 'active', NOW(), NOW())
     ON CONFLICT (agent_id, platform, account_label) DO UPDATE
       SET role='burner', status='active', bound_at=NOW()`,
    [agent_id, accountLabel],
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

// ── 3. GET /sessions — 列 burner sessions（从 session 解析 tenant，不信 query 占位）──
router.get('/sessions', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT s.account_label, s.role, s.status, s.bound_at,
              s.created_at,
              (SELECT response->>'account_nickname'
                 FROM zenithjoy.publish_tasks
                WHERE agent_id=s.agent_id
                  AND task_type='qr_bind/douyin_burner'
                  AND payload->>'account_label' = s.account_label
                ORDER BY created_at DESC LIMIT 1) AS account_nickname
         FROM zenithjoy.agent_platform_sessions s
         JOIN zenithjoy.agents a ON a.id = s.agent_id
        WHERE a.tenant_id=$1
          AND s.role='burner'
          AND s.platform='douyin'
        ORDER BY s.created_at DESC`,
      [tenantId],
    );
    return res.json(OK({ sessions: r.rows }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[burner/sessions] query failed:', msg);
    return res.status(500).json(ERR('SESSIONS_QUERY_FAILED', msg));
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

  // 校验飞书 binding
  const binding = await getFeishuBinding(tenant_id);
  if (!binding) {
    return res
      .status(400)
      .json(ERR('FEISHU_NOT_BOUND', 'tenant 未绑飞书，无法写入 Lead 表'));
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

  const binding = await getFeishuBinding(tenantId);
  if (!binding || !binding.table_id_leads) {
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status='failed',
         response = jsonb_build_object('lead_write_status', 'failed', 'error', 'FEISHU_NOT_BOUND'),
         updated_at = NOW()
       WHERE id=$1`,
      [task_id],
    );
    return res.json(OK({ updated: true, lead_write_status: 'failed' }));
  }

  const safeComments = Array.isArray(comments) ? comments : [];
  const writeRes = await writeLeadsFromComments({
    tenant_id: tenantId,
    table_id_leads: binding.table_id_leads,
    video_url: video_url || '',
    comments: safeComments,
  });

  const feishuBitableUrl = `https://feishu.cn/base/${binding.app_token}`;

  await pool.query(
    `UPDATE zenithjoy.publish_tasks SET status='done',
       response = jsonb_build_object(
         'comment_count', $2::int,
         'lead_write_status', $3::text,
         'feishu_bitable_url', $4::text,
         'video_url', $5::text
       ),
       updated_at = NOW()
     WHERE id=$1`,
    [
      task_id,
      safeComments.length,
      writeRes.lead_write_status,
      feishuBitableUrl,
      video_url || '',
    ],
  );

  return res.json(
    OK({
      task_id,
      comment_count: safeComments.length,
      lead_write_status: writeRes.lead_write_status,
      feishu_bitable_url: feishuBitableUrl,
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
  const { task_id, agent_id, account_label, status, error_code, profile_url, screenshot_path } =
    req.body || {};
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
  const dmStatus: DmStatus =
    status === 'sent' || status === 'limited' || status === 'failed' ? status : 'failed';

  const binding = await getFeishuBinding(tenantId);
  const feishuBitableUrl = binding?.app_token ? `https://feishu.cn/base/${binding.app_token}` : '';

  // failed + SESSION_EXPIRED/RISK → 仅停用「被触达的那个号」（不连坐同 agent 其他号）
  let sessionDisabled = false;
  if (dmStatus === 'failed' && error_code && DM_SESSION_KILLERS.includes(error_code)) {
    const upd = await pool.query(
      // agent_platform_sessions 无 updated_at 列（只 bound_at/created_at）— 不可写 updated_at
      `UPDATE zenithjoy.agent_platform_sessions SET status='expired'
        WHERE agent_id=$1 AND platform='douyin' AND account_label=$2 AND role='burner'`,
      [agentId, acctLabel],
    );
    sessionDisabled = (upd.rowCount ?? 0) > 0;
  }

  // 飞书 Lead 表回写触达状态
  let leadWriteStatus: 'success' | 'failed' = 'failed';
  if (binding?.table_id_leads) {
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

export default router;
export { router as agentBurnerRouter };
