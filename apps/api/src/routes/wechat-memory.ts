/**
 * /api/wechat/memory/* — Line04 对话记忆三层后端（tenant 隔离）
 *
 * 三端点（沿用 routes/wechat.ts plain-JSON 风格 + tenant 解析范式）：
 *   - POST /api/wechat/memory/message      写一条消息进短期
 *   - POST /api/wechat/memory/consolidate  触发日收尾（当天短期→中期；跨天中期→长期）
 *   - GET  /api/wechat/memory/context      取「长期+中期+短期」回复上下文
 *
 * 租户来源：X-Tenant-Id 头 或 body.tenant_id（cron / listen_chat 等非浏览器 caller
 * 显式传）。二者皆无 → 400 MISSING_TENANT，绝不回退全量、绝不串租户。
 */

import { Router, Request } from 'express';
import {
  appendTenantMessage,
  getReplyContext,
  runDailyConsolidation,
  MissingTenantError,
} from '../services/wechat/tenant-memory';

export const wechatMemoryRouter = Router();

const MISSING_TENANT = {
  error: 'MISSING_TENANT',
  message: '缺 tenant_id（X-Tenant-Id 头 / body.tenant_id 皆无）— 拒绝执行，不回退全量',
};

/** 解析当前租户：X-Tenant-Id 头优先，回退 body.tenant_id；皆无返回空串。 */
function resolveTenantId(req: Request): string {
  const headerVal = req.header('X-Tenant-Id');
  const bodyVal =
    req.body && typeof req.body.tenant_id === 'string' ? req.body.tenant_id : '';
  return (headerVal || bodyVal || '').trim();
}

// ─── POST /api/wechat/memory/message ────────────────────────────────────────
wechatMemoryRouter.post('/memory/message', async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json(MISSING_TENANT);

  const { contact, role, text } = req.body || {};
  if (!contact || !role || !text) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: '缺 contact/role/text' });
  }
  if (role !== 'in' && role !== 'out') {
    return res.status(400).json({ error: 'INVALID_ROLE', message: 'role 必须为 in 或 out' });
  }

  try {
    const r = await appendTenantMessage({ tenantId, contact, role, text });
    return res.status(200).json({
      ok: true,
      message_id: r.message_id,
      tenant_id: tenantId,
      contact,
    });
  } catch (e) {
    if (e instanceof MissingTenantError) return res.status(400).json(MISSING_TENANT);
    console.error('[wechat/memory/message] error:', e);
    return res.status(500).json({ error: 'INTERNAL', message: String(e) });
  }
});

// ─── POST /api/wechat/memory/consolidate ────────────────────────────────────
wechatMemoryRouter.post('/memory/consolidate', async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json(MISSING_TENANT);

  const { contact, day } = req.body || {};
  if (!contact) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: '缺 contact' });
  }

  try {
    const r = await runDailyConsolidation({ tenantId, contact, day });
    return res.status(200).json({
      ok: true,
      tenant_id: tenantId,
      contact,
      day: r.day,
      daily_generated: r.daily_generated,
      folded: r.folded,
    });
  } catch (e) {
    if (e instanceof MissingTenantError) return res.status(400).json(MISSING_TENANT);
    console.error('[wechat/memory/consolidate] error:', e);
    return res.status(500).json({ error: 'INTERNAL', message: String(e) });
  }
});

// ─── GET /api/wechat/memory/context?contact=X ───────────────────────────────
wechatMemoryRouter.get('/memory/context', async (req, res) => {
  // GET 无 body，租户只来自 X-Tenant-Id 头
  const tenantId = (req.header('X-Tenant-Id') || '').trim();
  if (!tenantId) return res.status(400).json(MISSING_TENANT);

  const contact = typeof req.query.contact === 'string' ? req.query.contact : '';
  if (!contact) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: '缺 contact' });
  }

  try {
    const r = await getReplyContext({ tenantId, contact });
    return res.status(200).json({
      ok: true,
      tenant_id: tenantId,
      contact,
      context: r.context,
      assembled: r.assembled,
    });
  } catch (e) {
    if (e instanceof MissingTenantError) return res.status(400).json(MISSING_TENANT);
    console.error('[wechat/memory/context] error:', e);
    return res.status(500).json({ error: 'INTERNAL', message: String(e) });
  }
});
