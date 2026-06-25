/**
 * Path 4 Step 2: CRM 打通路由
 *
 * POST /api/crm/init           — 建/检测客户明细表（mode: create | detect）
 * GET  /api/crm/wechat-contacts — 拉取微信联系人（mock 5 条）
 * GET  /api/crm/match-preview   — AI 匹配结果预览（matched/pending/unmatched）
 * POST /api/crm/daily-analysis  — 每日 8:30 AI 分析 + 飞书群推送（支持 dry_run）
 *
 * Line04 中台 AI-native CRM·客户列表页（租户闸 + 接管开关 + 状态 A1-A5 + 加客户）：
 * GET  /api/crm/customers         — 当前租户客户名册（需登录；按 req.tenantId scope）
 * PUT  /api/crm/customers/manage  — 接管开关 → 写 wechat_cs_account_config.whitelist（管理员+同租户）
 * PUT  /api/crm/customers/status  — 状态 A1-A5 持久化 crm_customers（管理员+同租户）
 * POST /api/crm/customers         — +加客户手动入册 source=manual（管理员+同租户）
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import {
  requireCsWriteAccess,
  requireCsReadAccess,
  requireServiceCredential,
} from '../middleware/cs-config-guard';
import { buildCustomerRoster } from '../services/crm/customer-roster';
import type { RosterScanRow, TakeoverMode } from '../services/crm/customer-roster';

const router = Router();

const VALID_STATUS = new Set(['A1', 'A2', 'A3', 'A4', 'A5']);

/**
 * 把 body.wechat_id（客服机微信号）映射到 req.params.wechatId，供 requireCsWriteAccess('wechatId')
 * 按 wechat_id → service_agents.tenant_id 解析目标租户做同租户隔离闸（写接口的 wechat_id 在 body 不在 path）。
 */
function bodyWechatIdToParam(req: Request, _res: Response, next: NextFunction): void {
  const wid = typeof req.body?.wechat_id === 'string' ? req.body.wechat_id.trim() : '';
  req.params = { ...req.params, wechatId: wid };
  next();
}

/** 优先取 tenantContext 解出的 req.tenantId；legacy/super-admin 通道无租户上下文时按 wechat_id 反查。 */
async function resolveTenantId(req: Request, csWechatId: string): Promise<string | null> {
  if (req.tenantId) return req.tenantId;
  const r = await pool.query(
    `SELECT tenant_id FROM zenithjoy.service_agents WHERE wechat_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [csWechatId],
  );
  return (r.rows?.[0]?.tenant_id as string | undefined) ?? null;
}

function fail(res: Response, status: number, code: string, message: string): Response {
  return res
    .status(status)
    .json({ success: false, data: null, error: { code, message }, timestamp: new Date().toISOString() });
}

// Mock 微信联系人数据（E2E 中精确 5 条）
const MOCK_WECHAT_CONTACTS = [
  { wechat_id: 'wx_001', nickname: '张三' },
  { wechat_id: 'wx_002', nickname: '李四' },
  { wechat_id: 'wx_003', nickname: '王五' },
  { wechat_id: 'wx_004', nickname: '赵六' },
  { wechat_id: 'wx_005', nickname: '陈七' },
];

// POST /api/crm/init — 建/检测客户明细表
router.post('/init', async (req: Request, res: Response) => {
  const { platform = 'feishu', tenant_id, mode = 'create' } = req.body as {
    platform?: string;
    tenant_id?: string;
    mode?: 'create' | 'detect';
  };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  if (mode === 'detect') {
    // 检测已有表 — 返回已有 table_id
    const table_id = `${platform}_crm_${tenant_id}_existing`;
    return res.json({ success: true, table_id });
  }

  // mode === 'create' — 建新表
  const table_id = `${platform}_crm_${tenant_id}_${Date.now()}`;
  return res.json({ success: true, table_id });
});

// GET /api/crm/wechat-contacts — 微信联系人（mock 精确 5 条）
router.get('/wechat-contacts', (req: Request, res: Response) => {
  const { tenant_id } = req.query as { tenant_id?: string };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  return res.json({ contacts: MOCK_WECHAT_CONTACTS });
});

// GET /api/crm/match-preview — AI 匹配结果预览
router.get('/match-preview', (req: Request, res: Response) => {
  const { tenant_id } = req.query as { tenant_id?: string };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  return res.json({
    matched: [],
    pending: MOCK_WECHAT_CONTACTS.slice(0, 2).map((c) => ({
      wechat_id: c.wechat_id,
      nickname: c.nickname,
      crm_candidate: null,
    })),
    unmatched: MOCK_WECHAT_CONTACTS.slice(2).map((c) => ({
      wechat_id: c.wechat_id,
      nickname: c.nickname,
    })),
  });
});

// POST /api/crm/daily-analysis — 每日 AI 分析（支持 dry_run）
// 响应格式：{ customers: CrmCustomer[], webhook_sent: boolean }
router.post('/daily-analysis', async (req: Request, res: Response) => {
  const { tenant_id, dry_run = false } = req.body as {
    tenant_id?: string;
    dry_run?: boolean;
  };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  const { runDailyCrmAnalysis } = await import('../services/daily-crm-analysis');
  const { customers, webhook_sent, analysis_time } = await runDailyCrmAnalysis({ tenant_id, dry_run });

  return res.json({ customers, webhook_sent, analysis_time });
});

// ─────────────────────────────────────────────────────────────────────────────
// Line04 中台 AI-native CRM·客户列表页
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析读名册的有效 scope（修正6 多通道 + 修正5 super-admin 显式 scope）：
 *   - 租户 session 用户（req.tenantId 非空）：scope = 该租户名下所有客服机；可选 cs_wechat_id 查询参数收窄到单台。
 *   - super-admin（req.tenantId 空/不存在）：必须显式传 cs_wechat_id（决策5：不一次拉全平台），
 *     按 cs_wechat_id → service_agents.tenant_id 解析所属租户后 scope 该单台。缺 cs_wechat_id → 返回 null（路由报 400）。
 * 返回 { tenantId, csWechatIds }；csWechatIds 为本次名册聚合覆盖的客服机微信号集合。
 */
async function resolveReadScope(
  req: Request,
): Promise<{ tenantId: string; csWechatIds: string[] } | { error: { status: number; code: string; message: string } }> {
  const explicitCs =
    typeof req.query.cs_wechat_id === 'string' ? req.query.cs_wechat_id.trim() : '';

  // 租户 session 用户：req.tenantId 非空
  if (req.tenantId) {
    const tenantId = req.tenantId;
    if (explicitCs) {
      // 收窄到单台，但必须属于本租户（deny by default 跨租户偷看）
      const r = await pool.query(
        `SELECT 1 FROM zenithjoy.service_agents
          WHERE wechat_id = $1 AND tenant_id = $2::uuid AND deleted_at IS NULL LIMIT 1`,
        [explicitCs, tenantId],
      );
      if (r.rowCount === 0)
        return { error: { status: 403, code: 'CROSS_TENANT', message: '该客服机不属于当前租户' } };
      return { tenantId, csWechatIds: [explicitCs] };
    }
    const agentsRes = await pool.query(
      `SELECT wechat_id FROM zenithjoy.service_agents
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND wechat_id IS NOT NULL`,
      [tenantId],
    );
    const csWechatIds = agentsRes.rows
      .map((r) => r.wechat_id as string)
      .filter((w): w is string => typeof w === 'string' && w.length > 0);
    return { tenantId, csWechatIds };
  }

  // super-admin（无 tenantId）：必须显式 cs_wechat_id（决策5），解析其租户
  if (!explicitCs)
    return {
      error: {
        status: 400,
        code: 'CS_WECHAT_ID_REQUIRED',
        message: 'super-admin 读名册须显式传 cs_wechat_id（不一次拉全平台）',
      },
    };
  const tr = await pool.query(
    `SELECT tenant_id FROM zenithjoy.service_agents WHERE wechat_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [explicitCs],
  );
  const tenantId = (tr.rows?.[0]?.tenant_id as string | undefined) ?? '';
  if (!tenantId)
    return { error: { status: 404, code: 'TARGET_NOT_FOUND', message: '解析不到该客服机所属租户' } };
  return { tenantId, csWechatIds: [explicitCs] };
}

// GET /api/crm/customers — 客户好友表（多通道鉴权修 403：租户 session ∪ legacy/super-admin）
// 黑名单主模型：response.managed = !blacklist.has(contact)（blacklist 模式）/ whitelist 模式回退；含 source/last_message。
router.get('/customers', requireCsReadAccess, async (req: Request, res: Response) => {
  try {
    const scope = await resolveReadScope(req);
    if ('error' in scope)
      return fail(res, scope.error.status, scope.error.code, scope.error.message);
    const { tenantId, csWechatIds } = scope;

    // 已聊过的人：cs_memory_messages 按 tenant×contact distinct + 最后联系时间
    const msgRes = await pool.query(
      `SELECT contact, MAX(created_at) AS last_contact_at
         FROM zenithjoy.cs_memory_messages
        WHERE tenant_id = $1
        GROUP BY contact`,
      [tenantId],
    );
    const messages = msgRes.rows.map((r) => ({
      contact: r.contact as string,
      last_contact_at: r.last_contact_at ? new Date(r.last_contact_at).toISOString() : null,
    }));

    // 手动入册 + agent 扫好友 + 已落状态的客户：crm_customers（按 source 拆 manual / scan 两源喂名册）
    const csWhere =
      csWechatIds.length > 0 ? ' AND cs_wechat_id = ANY($2::text[])' : '';
    const custParams: unknown[] = csWechatIds.length > 0 ? [tenantId, csWechatIds] : [tenantId];
    const custRes = await pool.query(
      `SELECT contact, wechat_id, status, source, last_message, last_seen_at
         FROM zenithjoy.crm_customers WHERE tenant_id = $1::uuid${csWhere}`,
      custParams,
    );
    const manualCustomers = custRes.rows
      .filter((r) => r.source !== 'scan')
      .map((r) => ({
        contact: r.contact as string,
        wechat_id: (r.wechat_id as string | null) ?? null,
        status: r.status as string,
      }));
    const scanContacts: RosterScanRow[] = custRes.rows
      .filter((r) => r.source === 'scan')
      .map((r) => ({
        contact: r.contact as string,
        wechat_id: (r.wechat_id as string | null) ?? null,
        status: r.status as string,
        last_message: (r.last_message as string | null) ?? null,
        last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      }));

    // 接管态：该 scope 内客服机配置（blacklist / whitelist / takeover_mode）
    let whitelist: string[] = [];
    let blacklist: string[] = [];
    let takeoverMode: TakeoverMode | undefined;
    if (csWechatIds.length > 0) {
      const cfgRes = await pool.query(
        `SELECT whitelist, blacklist, takeover_mode FROM zenithjoy.wechat_cs_account_config
          WHERE wechat_id = ANY($1::text[])`,
        [csWechatIds],
      );
      const wlSet = new Set<string>();
      const blSet = new Set<string>();
      const modes = new Set<string>();
      for (const row of cfgRes.rows) {
        for (const n of Array.isArray(row.whitelist) ? row.whitelist : [])
          if (typeof n === 'string') wlSet.add(n);
        for (const n of Array.isArray(row.blacklist) ? row.blacklist : [])
          if (typeof n === 'string') blSet.add(n);
        if (typeof row.takeover_mode === 'string') modes.add(row.takeover_mode);
      }
      whitelist = Array.from(wlSet);
      blacklist = Array.from(blSet);
      // scope 内模式不一：任一台是 blacklist → 整体按 blacklist 主模型（默认全接管，黑名单排除）。
      // 单台 scope（前端进单客服机视图 / super-admin 显式 cs_wechat_id）时该台模式即准确模式。
      takeoverMode = modes.has('blacklist') ? 'blacklist' : modes.has('whitelist') ? 'whitelist' : undefined;
    }

    const customers = await buildCustomerRoster({
      tenantId,
      csWechatId: csWechatIds[0] ?? '',
      takeoverMode,
      whitelist,
      blacklist,
      messages,
      manualCustomers,
      scanContacts,
    });
    // cs_wechat_id：本 scope 主客服机微信号，供前端写接口（manage/status/POST）作目标 key；
    // 非客户行字段，不在禁用字段之列，不影响 customers[] 形态。
    return res.json({ customers, total: customers.length, cs_wechat_id: csWechatIds[0] ?? null });
  } catch (err) {
    return fail(res, 500, 'ROSTER_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// PUT /api/crm/customers/manage — 接管开关 → 写 blacklist（黑名单主模型，幂等）
// 黑名单语义（修正3/4）：managed=false（排除）→ 把 contact 加进 blacklist；managed=true（接管）→ 从 blacklist 移除。
// 该客服机 takeover_mode 缺省（新接入）即 blacklist 主模型；first-write 时 INSERT 默认 takeover_mode=blacklist。
router.put(
  '/customers/manage',
  bodyWechatIdToParam,
  requireCsWriteAccess('wechatId'),
  async (req: Request, res: Response) => {
    const { wechat_id, contact, managed } = req.body as {
      wechat_id?: string;
      contact?: string;
      managed?: boolean;
    };
    const csWechatId = (wechat_id ?? '').trim();
    const name = (contact ?? '').trim();
    if (!csWechatId || !name) return res.status(400).json({ error: 'wechat_id 和 contact 必填' });
    try {
      const cur = await pool.query(
        `SELECT blacklist FROM zenithjoy.wechat_cs_account_config WHERE wechat_id = $1`,
        [csWechatId],
      );
      let bl: string[] = Array.isArray(cur.rows?.[0]?.blacklist)
        ? cur.rows[0].blacklist.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      if (managed) {
        // 接管 → 从黑名单移除
        bl = bl.filter((x) => x !== name);
      } else {
        // 排除 → 加进黑名单
        if (!bl.includes(name)) bl.push(name);
      }
      // 只更新 blacklist，保留既有 persona/whitelist/其它配置；新客服机首次写入给 persona 占位满足 NOT NULL，
      // takeover_mode 留列默认（blacklist，新接入主模型）。
      await pool.query(
        `INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id, persona, blacklist, updated_at)
         VALUES ($1, '{}'::jsonb, $2::jsonb, now())
         ON CONFLICT (wechat_id) DO UPDATE SET blacklist = $2::jsonb, updated_at = now()`,
        [csWechatId, JSON.stringify(bl)],
      );
      // managed = 不在黑名单（与 GET 名册 managed 判定 + agent should_reply 同字面一致）
      return res.json({ success: true, managed: !bl.includes(name), message: '保存成功' });
    } catch (err) {
      return fail(res, 500, 'MANAGE_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  },
);

// PUT /api/crm/customers/status — 状态 A1-A5 持久化
router.put(
  '/customers/status',
  bodyWechatIdToParam,
  requireCsWriteAccess('wechatId'),
  async (req: Request, res: Response) => {
    const { wechat_id, contact, status } = req.body as {
      wechat_id?: string;
      contact?: string;
      status?: string;
    };
    const csWechatId = (wechat_id ?? '').trim();
    const name = (contact ?? '').trim();
    const st = (status ?? '').trim();
    if (!csWechatId || !name) return res.status(400).json({ error: 'wechat_id 和 contact 必填' });
    if (!VALID_STATUS.has(st)) return res.status(400).json({ error: 'status 必须是 A1-A5' });
    const tenantId = await resolveTenantId(req, csWechatId);
    if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到所属租户');
    try {
      await pool.query(
        `INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, status, source, updated_at)
         VALUES ($1::uuid, $2, $3, $4, 'manual', now())
         ON CONFLICT (tenant_id, cs_wechat_id, contact) DO UPDATE SET status = $4, updated_at = now()`,
        [tenantId, csWechatId, name, st],
      );
      return res.json({ success: true, status: st });
    } catch (err) {
      return fail(res, 500, 'STATUS_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  },
);

// POST /api/crm/customers — +加客户手动入册
router.post(
  '/customers',
  bodyWechatIdToParam,
  requireCsWriteAccess('wechatId'),
  async (req: Request, res: Response) => {
    const { wechat_id, name, contact } = req.body as {
      wechat_id?: string;
      name?: string;
      contact?: string;
    };
    const csWechatId = (wechat_id ?? '').trim();
    const c = (contact ?? '').trim();
    const nm = (name ?? '').trim() || c;
    if (!csWechatId) return res.status(400).json({ error: 'wechat_id 必填' });
    if (!c) return res.status(400).json({ error: 'contact 必填' });
    const tenantId = await resolveTenantId(req, csWechatId);
    if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到所属租户');
    try {
      await pool.query(
        `INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, wechat_id, status, source)
         VALUES ($1::uuid, $2, $3, NULL, 'A1', 'manual')
         ON CONFLICT (tenant_id, cs_wechat_id, contact) DO UPDATE SET updated_at = now()`,
        [tenantId, csWechatId, c],
      );
      return res.json({
        success: true,
        customer: { name: nm, contact: c, wechat_id: null, status: 'A1', managed: false },
      });
    } catch (err) {
      return fail(res, 500, 'CREATE_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 修正5：agent 扫好友上报 ingest（service token 专用，非人类 session）
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/crm/friend-scan/ingest — agent 上报客服机近期会话联系人，upsert 幂等落 crm_customers source='scan'
// body: { cs_wechat_id, contacts:[{name, last_message?, last_seen?}] }
// 响应: { success, ingested, new, scanned_count }
router.post('/friend-scan/ingest', requireServiceCredential, async (req: Request, res: Response) => {
  const body = req.body as {
    cs_wechat_id?: string;
    contacts?: Array<{ name?: string; last_message?: string; last_seen?: string }>;
  };
  const csWechatId = (body.cs_wechat_id ?? '').trim();
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  if (!csWechatId) return res.status(400).json({ error: 'cs_wechat_id 必填' });
  if (!Array.isArray(body.contacts))
    return res.status(400).json({ error: 'contacts 必须是数组' });

  // ingest 无 req.tenantId（service token），按 cs_wechat_id → service_agents.tenant_id 解析所属租户
  const tenantId = await resolveTenantId(req, csWechatId);
  if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到该客服机所属租户');

  // 规范化 + 去重（同名取首条），过滤空名
  const seen = new Set<string>();
  const rows: Array<{ name: string; last_message: string | null; last_seen: string | null }> = [];
  for (const c of contacts) {
    const name = (c?.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({
      name,
      last_message: typeof c?.last_message === 'string' ? c.last_message : null,
      last_seen: typeof c?.last_seen === 'string' ? c.last_seen : null,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let newCount = 0;
    for (const r of rows) {
      // upsert 幂等（按 tenant_id, cs_wechat_id, contact）：新行 source='scan'；已存在则只补扫描观测字段，
      // 绝不把已聊过/手动入册（source=message/manual）的行降级成 scan（COALESCE 保 source 不回退）。
      const up = await client.query(
        `INSERT INTO zenithjoy.crm_customers
           (tenant_id, cs_wechat_id, contact, source, last_message, last_seen_at, updated_at)
         VALUES ($1::uuid, $2, $3, 'scan', $4, $5, now())
         ON CONFLICT (tenant_id, cs_wechat_id, contact) DO UPDATE
           SET last_message = COALESCE(EXCLUDED.last_message, zenithjoy.crm_customers.last_message),
               last_seen_at = COALESCE(EXCLUDED.last_seen_at, zenithjoy.crm_customers.last_seen_at),
               updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [tenantId, csWechatId, r.name, r.last_message, r.last_seen],
      );
      if (up.rows?.[0]?.inserted === true) newCount += 1;
    }

    // 更新 onboarding O2 scanned_count + step_o2_scanned（拉到人即 ok，0 人记 fail）；
    // 同时消费掉「立即扫好友」强制请求（force_scan_requested_at 置 NULL）——本次 ingest 即这次强制扫的结果。
    const scannedCount = rows.length;
    await client.query(
      `INSERT INTO zenithjoy.crm_onboarding_state (tenant_id, cs_wechat_id, step_o2_scanned, scanned_count, force_scan_requested_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, NULL, now())
       ON CONFLICT (tenant_id, cs_wechat_id) DO UPDATE
         SET step_o2_scanned = $3, scanned_count = $4, force_scan_requested_at = NULL, updated_at = now()`,
      [tenantId, csWechatId, scannedCount > 0 ? 'ok' : 'fail', scannedCount],
    );

    await client.query('COMMIT');
    return res.json({ success: true, ingested: rows.length, new: newCount, scanned_count: scannedCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, 500, 'INGEST_FAILED', err instanceof Error ? err.message : 'unknown');
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 立即扫好友：trigger（网页用户点）→ pending（agent 轮询）→ ingest 成功后后端清标志
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/crm/friend-scan/trigger — 网页用户点「立即扫好友」，设 force_scan_requested_at=now()
// body: { cs_wechat_id }
// 鉴权 requireCsReadAccess（同租户/超管，**不是** requireServiceCredential——要让网页用户能点）。
// 响应: { ok, requested_at }
router.post('/friend-scan/trigger', requireCsReadAccess, async (req: Request, res: Response) => {
  const csWechatId = (typeof req.body?.cs_wechat_id === 'string' ? req.body.cs_wechat_id : '').trim();
  if (!csWechatId) return res.status(400).json({ error: 'cs_wechat_id 必填' });

  // 解析所属租户：租户 session 用 req.tenantId；super-admin（无 tenantId）按 cs_wechat_id 反查。
  const tenantId = await resolveTenantId(req, csWechatId);
  if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到该客服机所属租户');

  // 租户 session 用户带 cs 时，校验该 cs 属本租户（deny by default 跨租户偷点别家的客服机）。
  if (req.tenantId) {
    const own = await pool.query(
      `SELECT 1 FROM zenithjoy.service_agents
        WHERE wechat_id = $1 AND tenant_id = $2::uuid AND deleted_at IS NULL LIMIT 1`,
      [csWechatId, tenantId],
    );
    if (own.rowCount === 0) return fail(res, 403, 'CROSS_TENANT', '该客服机不属于当前租户');
  }

  try {
    // 设 force_scan_requested_at=now()；首插带默认其它列，冲突只更该列。
    const r = await pool.query(
      `INSERT INTO zenithjoy.crm_onboarding_state (tenant_id, cs_wechat_id, force_scan_requested_at, updated_at)
       VALUES ($1::uuid, $2, now(), now())
       ON CONFLICT (tenant_id, cs_wechat_id) DO UPDATE
         SET force_scan_requested_at = now(), updated_at = now()
       RETURNING force_scan_requested_at`,
      [tenantId, csWechatId],
    );
    const requestedAt = r.rows?.[0]?.force_scan_requested_at
      ? new Date(r.rows[0].force_scan_requested_at).toISOString()
      : null;
    return res.json({ ok: true, requested_at: requestedAt });
  } catch (err) {
    return fail(res, 500, 'TRIGGER_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// GET /api/crm/friend-scan/pending?cs_wechat_id=X — agent 轮询是否有未消费的强制扫描请求
// 鉴权 requireServiceCredential（agent internal token；非人类 session）。
// 响应: { ok, force, requested_at }
//   force = force_scan_requested_at IS NOT NULL（ingest 成功后会被置 NULL，所以非空即「这次还没扫过」）。
router.get('/friend-scan/pending', requireServiceCredential, async (req: Request, res: Response) => {
  const csWechatId = (typeof req.query.cs_wechat_id === 'string' ? req.query.cs_wechat_id : '').trim();
  if (!csWechatId) return res.status(400).json({ error: 'cs_wechat_id 必填' });

  // agent 无 req.tenantId（service token），按 cs_wechat_id → service_agents.tenant_id 解析所属租户。
  const tenantId = await resolveTenantId(req, csWechatId);
  if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到该客服机所属租户');

  try {
    const r = await pool.query(
      `SELECT force_scan_requested_at
         FROM zenithjoy.crm_onboarding_state
        WHERE tenant_id = $1::uuid AND cs_wechat_id = $2 LIMIT 1`,
      [tenantId, csWechatId],
    );
    const raw = r.rows?.[0]?.force_scan_requested_at ?? null;
    const requestedAt = raw ? new Date(raw).toISOString() : null;
    return res.json({ ok: true, force: requestedAt !== null, requested_at: requestedAt });
  } catch (err) {
    return fail(res, 500, 'PENDING_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 修正7：onboarding 状态机（O1-O5 自检态）
// ─────────────────────────────────────────────────────────────────────────────

const ONBOARDING_STEP_KEYS = [
  'step_o1_online',
  'step_o2_scanned',
  'step_o3_roster',
  'step_o4_realpublish',
  'step_o5_replied',
] as const;
const VALID_STEP_STATE = new Set(['pending', 'ok', 'fail']);

// GET /api/crm/onboarding/:csWechatId — 读 onboarding 状态机（多通道：租户 session ∪ legacy/super-admin）
router.get('/onboarding/:csWechatId', requireCsReadAccess, async (req: Request, res: Response) => {
  const csWechatId = (req.params.csWechatId ?? '').trim();
  if (!csWechatId) return res.status(400).json({ error: 'csWechatId 必填' });
  const tenantId = await resolveTenantId(req, csWechatId);
  if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到该客服机所属租户');
  try {
    const r = await pool.query(
      `SELECT step_o1_online, step_o2_scanned, scanned_count, step_o3_roster,
              blacklist_count, step_o4_realpublish, step_o5_replied, updated_at
         FROM zenithjoy.crm_onboarding_state
        WHERE tenant_id = $1::uuid AND cs_wechat_id = $2 LIMIT 1`,
      [tenantId, csWechatId],
    );
    // 无记录 → 返回全 pending 的默认态（前端状态条照常画灰）
    const row = r.rows?.[0] ?? {
      step_o1_online: 'pending',
      step_o2_scanned: 'pending',
      scanned_count: 0,
      step_o3_roster: 'pending',
      blacklist_count: 0,
      step_o4_realpublish: 'pending',
      step_o5_replied: 'pending',
      updated_at: null,
    };
    return res.json({ success: true, cs_wechat_id: csWechatId, onboarding: row });
  } catch (err) {
    return fail(res, 500, 'ONBOARDING_READ_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// PUT /api/crm/onboarding/:csWechatId — agent/系统回写某步自检结果（service token 专用）
// body: { step_o1_online?, step_o2_scanned?, scanned_count?, step_o3_roster?, blacklist_count?, step_o4_realpublish?, step_o5_replied? }
router.put('/onboarding/:csWechatId', requireServiceCredential, async (req: Request, res: Response) => {
  const csWechatId = (req.params.csWechatId ?? '').trim();
  if (!csWechatId) return res.status(400).json({ error: 'csWechatId 必填' });
  const tenantId = await resolveTenantId(req, csWechatId);
  if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到该客服机所属租户');

  const body = (req.body ?? {}) as Record<string, unknown>;
  // 校验 step 三态合法
  for (const k of ONBOARDING_STEP_KEYS) {
    if (k in body && !VALID_STEP_STATE.has(String(body[k])))
      return res.status(400).json({ error: `${k} 必须是 pending/ok/fail` });
  }

  // 动态拼可变更新列（只更传了的字段；缺省列保留旧值 / 首插落默认）
  const updatable: Record<string, unknown> = {};
  for (const k of ONBOARDING_STEP_KEYS) if (k in body) updatable[k] = String(body[k]);
  if ('scanned_count' in body) updatable.scanned_count = Number(body.scanned_count) || 0;
  if ('blacklist_count' in body) updatable.blacklist_count = Number(body.blacklist_count) || 0;

  const cols = Object.keys(updatable);
  if (cols.length === 0) return res.status(400).json({ error: '无可更新字段' });

  try {
    // INSERT ... ON CONFLICT DO UPDATE：首插带传入字段（其余列走表默认），冲突则只更传入列。
    const insertCols = ['tenant_id', 'cs_wechat_id', ...cols];
    const insertVals = [tenantId, csWechatId, ...cols.map((c) => updatable[c])];
    const placeholders = insertCols.map((_, i) => `$${i + 1}`);
    placeholders[0] = '$1::uuid';
    const setClause = cols.map((c) => `${c} = EXCLUDED.${c}`).concat('updated_at = now()').join(', ');
    await pool.query(
      `INSERT INTO zenithjoy.crm_onboarding_state (${insertCols.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (tenant_id, cs_wechat_id) DO UPDATE SET ${setClause}`,
      insertVals,
    );
    return res.json({ success: true, cs_wechat_id: csWechatId, updated: cols });
  } catch (err) {
    return fail(res, 500, 'ONBOARDING_WRITE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 修正2：三层下钻 层2/3 数据端点（客户画像 + 状态时间线 + 每日小结流 + 真实聊天记录）
// 响应 shape 严格对齐 crm-frontend CustomerProfilePage 已编码契约（它是 shape 源）。
// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_MSG_DEFAULT_LIMIT = 200; // 聊天逐句默认上限（防拉爆；前端按需展开但不分页，给个保底大窗）

// GET /api/crm/customers/:contactKey/profile — 单客户画像聚合（多通道读闸）
// :contactKey = encodeURIComponent(contact)（微信昵称）；cs_wechat_id 走 query ?cs=（前端契约）。
// scope：contact + cs_wechat_id + tenant 三元组定位，绝不跨租户泄漏。
// 数据源：portrait←cs_memory_longterm，dailies←cs_memory_daily，messages←cs_memory_messages，
//   timeline/基础信息←crm_customers（无状态历史表→timeline 返回当前状态单元素）。
// 响应：{ profile: { name, contact, wechat_id, status, managed, last_contact_at, portrait, timeline, dailies, messages } }。
router.get('/customers/:contactKey/profile', requireCsReadAccess, async (req: Request, res: Response) => {
  // Express 已对路由参数自动 decode（前端 encodeURIComponent 一次 → 这里拿到的就是原始 contact）。
  // 绝不再 decodeURIComponent：含字面 % 的昵称（如 "5%off"）会 URI malformed 抛错并崩进程（double-decode bug）。
  const contact = (req.params.contactKey ?? '').trim();
  if (!contact) return res.status(400).json({ error: 'contactKey 必填' });
  // 前端用 ?cs=<cs_wechat_id>；兼容 ?cs_wechat_id=
  const csWechatId =
    (typeof req.query.cs === 'string' ? req.query.cs.trim() : '') ||
    (typeof req.query.cs_wechat_id === 'string' ? req.query.cs_wechat_id.trim() : '');

  // 解析所属租户：租户 session 用 req.tenantId；super-admin（无 tenantId）按 cs_wechat_id 反查（决策5 须显式 cs）。
  const tenantId = await resolveTenantId(req, csWechatId);
  if (!tenantId) return fail(res, 404, 'TARGET_NOT_FOUND', '解析不到所属租户（缺 cs 或客服机不存在）');

  // super-admin 经 cs 反查出 tenant 后，cs_wechat_id 必属该 tenant（反查即保证）；
  // 租户 session 用户带了 cs 时，校验该 cs 属本租户（deny by default 跨租户偷看）。
  if (req.tenantId && csWechatId) {
    const own = await pool.query(
      `SELECT 1 FROM zenithjoy.service_agents
        WHERE wechat_id = $1 AND tenant_id = $2::uuid AND deleted_at IS NULL LIMIT 1`,
      [csWechatId, tenantId],
    );
    if (own.rowCount === 0)
      return fail(res, 403, 'CROSS_TENANT', '该客服机不属于当前租户');
  }

  const msgLimit = (() => {
    const n = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10);
    return Number.isFinite(n) && n > 0 && n <= 1000 ? n : PROFILE_MSG_DEFAULT_LIMIT;
  })();

  try {
    // crm_customers 基础信息（状态 / 微信号 / 来源 / 扫描观测）——按 tenant + contact 定位；
    // 带 cs 时收窄到该客服机那一行（同 contact 跨客服机理论可重，带 cs 更精确）。
    const custParams: unknown[] = csWechatId ? [tenantId, contact, csWechatId] : [tenantId, contact];
    const custRes = await pool.query(
      `SELECT contact, wechat_id, status, source, last_seen_at, updated_at
         FROM zenithjoy.crm_customers
        WHERE tenant_id = $1::uuid AND contact = $2${csWechatId ? ' AND cs_wechat_id = $3' : ''}
        ORDER BY updated_at DESC LIMIT 1`,
      custParams,
    );
    const cust = custRes.rows?.[0] as
      | { wechat_id: string | null; status: string; last_seen_at: Date | null; updated_at: Date }
      | undefined;

    // 长期记忆融合 summary（cs_memory 三表按 tenant_id text × contact 隔离，与 tenant-memory.ts 同模式）
    const ltRes = await pool.query(
      `SELECT summary, updated_at FROM zenithjoy.cs_memory_longterm
        WHERE tenant_id = $1 AND contact = $2 LIMIT 1`,
      [tenantId, contact],
    );
    const ltSummary = (ltRes.rows?.[0]?.summary as string | undefined) ?? null;
    // portrait：第一刀无结构化 need/budget/concern 列，全文落 summary（前端兜底全展示）；有则给对象，无则 null。
    const portrait = ltSummary
      ? { need: null, budget: null, concern: null, summary: ltSummary }
      : null;

    // 每日小结流（按天倒序，新在前）
    const dailyRes = await pool.query(
      `SELECT to_char(summary_day, 'YYYY-MM-DD') AS day, summary
         FROM zenithjoy.cs_memory_daily
        WHERE tenant_id = $1 AND contact = $2
        ORDER BY summary_day DESC`,
      [tenantId, contact],
    );
    const dailies = dailyRes.rows.map((r) => ({ day: r.day as string, summary: r.summary as string }));

    // 真实聊天逐句（role in=客户 / out=客服）。库内取最近 N 条（DESC 防拉爆），再翻成升序给前端按气泡流自然展示。
    const msgRes = await pool.query(
      `SELECT role, text, created_at
         FROM zenithjoy.cs_memory_messages
        WHERE tenant_id = $1 AND contact = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [tenantId, contact, msgLimit],
    );
    const messages = msgRes.rows
      .map((r) => ({
        role: r.role as 'in' | 'out',
        text: r.text as string,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      }))
      .reverse();

    // last_contact_at：优先聊天最后时间，回落扫描观测 last_seen_at
    const lastMsgAt = msgRes.rows.length > 0 ? new Date(msgRes.rows[0].created_at).toISOString() : null;
    const lastContactAt =
      lastMsgAt ?? (cust?.last_seen_at ? new Date(cust.last_seen_at).toISOString() : null);

    // managed 实时判定（与名册同模型）：读该 cs 的 takeover_mode + blacklist/whitelist。
    let managed = true;
    if (csWechatId) {
      const cfgRes = await pool.query(
        `SELECT whitelist, blacklist, takeover_mode FROM zenithjoy.wechat_cs_account_config WHERE wechat_id = $1`,
        [csWechatId],
      );
      const cfg = cfgRes.rows?.[0];
      if (cfg) {
        const mode = cfg.takeover_mode === 'blacklist' ? 'blacklist' : cfg.takeover_mode === 'whitelist' ? 'whitelist' : undefined;
        const bl = new Set((Array.isArray(cfg.blacklist) ? cfg.blacklist : []).filter((x: unknown): x is string => typeof x === 'string'));
        const wl = new Set((Array.isArray(cfg.whitelist) ? cfg.whitelist : []).filter((x: unknown): x is string => typeof x === 'string'));
        managed = mode === 'blacklist' ? !bl.has(contact) : mode === 'whitelist' ? wl.has(contact) : !bl.has(contact);
      }
    }

    const status = normalizeProfileStatus(cust?.status);
    // timeline：无状态历史表 → 返回当前状态单元素（at=最后更新时间，note 说明）。
    const timeline =
      cust !== undefined
        ? [{ status, at: cust.updated_at ? new Date(cust.updated_at).toISOString() : null, note: '当前状态（无历史流转表）' }]
        : [];

    return res.json({
      profile: {
        name: contact,
        contact,
        wechat_id: (cust?.wechat_id as string | null) ?? null,
        status,
        managed,
        last_contact_at: lastContactAt,
        portrait,
        timeline,
        dailies,
        messages,
      },
    });
  } catch (err) {
    return fail(res, 500, 'PROFILE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

/** 画像状态规范到 A1-A5（与 customer-roster.normalizeStatus 同口径，缺省 A1）。 */
function normalizeProfileStatus(s: unknown): 'A1' | 'A2' | 'A3' | 'A4' | 'A5' {
  return typeof s === 'string' && VALID_STATUS.has(s) ? (s as 'A1' | 'A2' | 'A3' | 'A4' | 'A5') : 'A1';
}

export default router;
