/**
 * 智能获客「分析+指派」中台路由（刀1）
 * 契约：scratchpad/dispatch-engine-contract.md「API 端点」节
 *
 * 全部 tenantContextOptional：租户从 req.tenantId（session / X-Tenant-Id 头），绝不信 query.tenant_id。
 *
 *   GET  /api/acquisition/config           读配置（无则返默认）
 *   PUT  /api/acquisition/config           upsert（数值范围校验，非法 400）
 *   POST /api/acquisition/dispatch/build   scoreLeads + buildAssignments → {scored, assigned, ...}
 *   POST /api/acquisition/dispatch/run     dispatchDue → {dispatched, ...}
 *   GET  /api/acquisition/dispatch/plan    读 dm_assignments（join leads）倒序 scheduled_for
 *   GET  /api/acquisition/cookie-health    各号 healthy/stale/expired + 需重扫项
 */
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContextOptional } from '../middleware/tenant-context';
import { enqueueWarmupTasks } from '../services/warmup-dispatch';
import {
  getConfig,
  upsertConfig,
  validateConfigPatch,
  scoreLeads,
  buildAssignments,
  dispatchDue,
  cookieHealth,
} from '../services/acquisition-dispatch';

export const acquisitionDispatchRouter = Router();

const ERR = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});
const OK = (data: unknown) => ({ success: true, data, timestamp: new Date().toISOString() });

function tenantOf(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) {
    res.status(401).json(ERR('NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）'));
    return null;
  }
  return t;
}

// ── GET /config — 读配置（无则返默认）──
acquisitionDispatchRouter.get('/config', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const cfg = await getConfig(pool, tenantId);
  return res.json(OK(cfg));
});

// ── PUT /config — upsert（数值范围校验，非法 400）──
acquisitionDispatchRouter.put('/config', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const patch = (req.body ?? {}) as Record<string, unknown>;
  const err = validateConfigPatch(patch);
  if (err) return res.status(400).json(ERR('INVALID_CONFIG', err));
  const cfg = await upsertConfig(pool, tenantId, patch);
  return res.json(OK(cfg));
});

// ── POST /dispatch/build — scoreLeads + buildAssignments ──
acquisitionDispatchRouter.post('/dispatch/build', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const { scored } = await scoreLeads(pool, tenantId);
  const build = await buildAssignments(pool, tenantId, new Date());
  return res.json(OK({ scored, ...build }));
});

// ── POST /dispatch/run — dispatchDue ──
acquisitionDispatchRouter.post('/dispatch/run', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const result = await dispatchDue(pool, tenantId, new Date());
  return res.json(OK(result));
});

// ── POST /warmup/run — 手动触发 enqueueWarmupTasks（staging 真机 + smoke 用；每日自动走 scheduler cron）──
acquisitionDispatchRouter.post('/warmup/run', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  // 手动触发可显式指定收尾要切回的操作号昵称（staging 真机验证切号用）；不传则空串=不切。
  const operatorNickname = typeof req.body?.operator_nickname === 'string' ? req.body.operator_nickname : '';
  const result = await enqueueWarmupTasks(tenantId, operatorNickname);
  return res.json(OK(result));
});

// ── GET /dispatch/plan — 读 dm_assignments（join leads）倒序 scheduled_for ──
acquisitionDispatchRouter.get('/dispatch/plan', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : null;
  const params: unknown[] = [tenantId];
  let statusClause = '';
  if (status) {
    params.push(status);
    statusClause = ` AND a.status = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT a.id, a.lead_id, a.account_label, a.status, a.scheduled_for, a.created_at,
            l.nickname, l.profile_url, l.relevance_score
       FROM zenithjoy.dm_assignments a
       LEFT JOIN zenithjoy.acquisition_leads l ON l.id = a.lead_id
      WHERE a.tenant_id = $1${statusClause}
      ORDER BY a.scheduled_for DESC NULLS LAST, a.created_at DESC
      LIMIT 500`,
    params
  );
  const plan = r.rows.map((row) => ({
    id: row.id,
    lead_id: row.lead_id,
    nickname: row.nickname ?? null,
    profile_url: row.profile_url ?? null,
    relevance_score: row.relevance_score ?? null,
    account_label: row.account_label,
    status: row.status,
    scheduled_for: row.scheduled_for,
  }));
  return res.json(OK({ plan, total: plan.length }));
});

// ── GET /outreach-history — 触达历史（dm_assignments JOIN dm_outreach_log JOIN acquisition_leads）──
// 注册在两个路径下：/outreach-history（既有 Dashboard 前端调用路径，不改）+
// /dispatch/outreach-history（sprint 07052218 contract-draft.md 验证命令指定路径，两者同一 handler）。
async function outreachHistoryHandler(req: Request, res: Response) {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  try {
    // 显式 cast $1：dm_assignments.tenant_id 是 text，acquisition_leads.tenant_id 是 uuid，
    // 同一个占位符在两处类型不同，pg 会按首次出现处推断类型导致另一处 "operator does not
    // exist: text = uuid"（此前正是这个类型不匹配错误被 catch 分支静默吞掉，跟缺
    // assignment_id 列是两个独立断点，本 sprint 一并修，理由同 Step 7 scope 边界声明）。
    const r = await pool.query(
      `SELECT a.id, a.account_label, a.status, a.scheduled_for,
              l.nickname AS lead_nickname,
              ol.sent_at
         FROM zenithjoy.dm_assignments a
         LEFT JOIN zenithjoy.acquisition_leads l ON l.id = a.lead_id AND l.tenant_id = $1::uuid
         LEFT JOIN zenithjoy.dm_outreach_log ol ON ol.assignment_id = a.id
        WHERE a.tenant_id = $1::text
        ORDER BY a.scheduled_for DESC NULLS LAST, a.created_at DESC
        LIMIT 500`,
      [tenantId]
    );
    const items = r.rows.map((row) => ({
      id: row.id,
      lead_nickname: row.lead_nickname ?? null,
      account_label: row.account_label,
      status: row.status,
      scheduled_for: row.scheduled_for ?? null,
      sent_at: row.sent_at ?? null,
    }));
    return res.json(OK({ items, total: items.length }));
  } catch {
    return res.json(OK({ items: [], total: 0 }));
  }
}
acquisitionDispatchRouter.get('/outreach-history', tenantContextOptional, outreachHistoryHandler);
acquisitionDispatchRouter.get('/dispatch/outreach-history', tenantContextOptional, outreachHistoryHandler);

// ── GET /cookie-health — 各号健康分类 + 需重扫项 ──
acquisitionDispatchRouter.get('/cookie-health', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const { items, alerts } = await cookieHealth(pool, tenantId, new Date());
  return res.json(OK({ items, alerts, alert_count: alerts.length }));
});

export default acquisitionDispatchRouter;
