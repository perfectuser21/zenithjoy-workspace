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
import { tenantContext } from '../middleware/tenant-context';
import { requireCsWriteAccess } from '../middleware/cs-config-guard';
import { buildCustomerRoster } from '../services/crm/customer-roster';

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

// GET /api/crm/customers — 当前租户客户名册（读接口补租户闸：scope = req.tenantId 自己客服机）
router.get('/customers', tenantContext, async (req: Request, res: Response) => {
  const tenantId = req.tenantId as string;
  try {
    // 该租户名下所有客服机微信号
    const agentsRes = await pool.query(
      `SELECT wechat_id FROM zenithjoy.service_agents
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND wechat_id IS NOT NULL`,
      [tenantId],
    );
    const csWechatIds: string[] = agentsRes.rows
      .map((r) => r.wechat_id as string)
      .filter((w): w is string => typeof w === 'string' && w.length > 0);

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

    // 手动入册 + 已落状态的客户：crm_customers
    const manualRes = await pool.query(
      `SELECT contact, wechat_id, status FROM zenithjoy.crm_customers WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    const manualCustomers = manualRes.rows.map((r) => ({
      contact: r.contact as string,
      wechat_id: (r.wechat_id as string | null) ?? null,
      status: r.status as string,
    }));

    // 接管态：该租户所有客服机 whitelist 并集（实时读，非缓存）
    let whitelist: string[] = [];
    if (csWechatIds.length > 0) {
      const wlRes = await pool.query(
        `SELECT whitelist FROM zenithjoy.wechat_cs_account_config WHERE wechat_id = ANY($1::text[])`,
        [csWechatIds],
      );
      const set = new Set<string>();
      for (const row of wlRes.rows) {
        const wl = Array.isArray(row.whitelist) ? row.whitelist : [];
        for (const name of wl) if (typeof name === 'string') set.add(name);
      }
      whitelist = Array.from(set);
    }

    const customers = await buildCustomerRoster({
      tenantId,
      csWechatId: csWechatIds[0] ?? '',
      whitelist,
      messages,
      manualCustomers,
    });
    // cs_wechat_id：本租户主客服机微信号，供前端写接口（manage/status/POST）作目标 key；
    // 非客户行字段，不在禁用字段之列，不影响 customers[] 形态。
    return res.json({ customers, total: customers.length, cs_wechat_id: csWechatIds[0] ?? null });
  } catch (err) {
    return fail(res, 500, 'ROSTER_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// PUT /api/crm/customers/manage — 接管开关 → 写 whitelist（幂等）
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
        `SELECT whitelist FROM zenithjoy.wechat_cs_account_config WHERE wechat_id = $1`,
        [csWechatId],
      );
      let wl: string[] = Array.isArray(cur.rows?.[0]?.whitelist)
        ? cur.rows[0].whitelist.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      if (managed) {
        if (!wl.includes(name)) wl.push(name);
      } else {
        wl = wl.filter((x) => x !== name);
      }
      // 只更新 whitelist，保留既有 persona/其它配置；新客服机首次写入给 persona 占位满足 NOT NULL
      await pool.query(
        `INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id, persona, whitelist, updated_at)
         VALUES ($1, '{}'::jsonb, $2::jsonb, now())
         ON CONFLICT (wechat_id) DO UPDATE SET whitelist = $2::jsonb, updated_at = now()`,
        [csWechatId, JSON.stringify(wl)],
      );
      return res.json({ success: true, managed: wl.includes(name), message: '保存成功' });
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

export default router;
