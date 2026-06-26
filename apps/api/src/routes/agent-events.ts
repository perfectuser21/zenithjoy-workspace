/**
 * Agent 观测事件路由 — Line02/Agent 观测（thin 第一刀）
 *
 * 契约：scratchpad/observability-contract.md
 *   POST /api/agent/events                 agent 上报（x-license-key 鉴权，tenant 来自 license）
 *   GET  /api/agent/machines/:id/events     dashboard 读（tenantContextOptional，绝不信 query.tenant_id）
 *
 * 鉴权分工：
 *   - POST 用 licenseAuth（复刻 walking-skeleton 心跳的 license→tenant 校验，落库 tenant_id 来自 license）。
 *   - GET 用 tenantContextOptional（session / X-Tenant-Id 头），:id=agents.id(uuid) → 查 agent_id(text) +
 *     tenant 双过滤；机器不属本租户 → 404。
 *
 * 注册顺序：mount 在 /api/agent，路径写全 /events 与 /machines/:id/events，
 *   放在 agentMachinesRouter 之后、agentRouter 之前（避免被 /api/agent/machines 或 /api/agent 吞）。
 */
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { licenseAuth } from '../middleware/license-auth';
import { tenantContextOptional } from '../middleware/tenant-context';

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

const VALID_KINDS = ['log', 'upgrade'];

interface RawEvent {
  agent_id?: unknown;
  kind?: unknown;
  level?: unknown;
  module?: unknown;
  phase?: unknown;
  percent?: unknown;
  message?: unknown;
  context?: unknown;
}

// 把单条事件规整成入库参数（kind 必校验；其余字段可空）
function normEvent(e: RawEvent): {
  agent_id: string;
  kind: string;
  level: string | null;
  module: string | null;
  phase: string | null;
  percent: number | null;
  message: string | null;
  context: unknown;
} | null {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.agent_id !== 'string' || !e.agent_id.trim()) return null;
  if (typeof e.kind !== 'string' || !VALID_KINDS.includes(e.kind)) return null;
  return {
    agent_id: e.agent_id.trim(),
    kind: e.kind,
    level: typeof e.level === 'string' ? e.level : null,
    module: typeof e.module === 'string' ? e.module : null,
    phase: typeof e.phase === 'string' ? e.phase : null,
    percent: typeof e.percent === 'number' ? e.percent : null,
    message: typeof e.message === 'string' ? e.message : null,
    context: e.context && typeof e.context === 'object' ? e.context : {},
  };
}

// ── 1. POST /events — agent 上报（单条或 {events:[...]} 批量）──
router.post('/events', licenseAuth, async (req: Request, res: Response) => {
  const tenantId = req.license?.tenant_id;
  if (!tenantId) {
    // licenseAuth 已过滤 NO_TENANT，这里 defensive
    return res.status(401).json(ERR('NO_TENANT', 'license 未关联 tenant'));
  }

  const body = (req.body ?? {}) as { events?: unknown };
  const isBatch = Array.isArray(body.events);
  const rawList: RawEvent[] = isBatch ? (body.events as RawEvent[]) : [body as RawEvent];

  if (rawList.length === 0) {
    return res.status(400).json(ERR('NO_EVENTS', 'events 为空'));
  }

  const norm = rawList.map(normEvent);
  if (norm.some((n) => n === null)) {
    return res
      .status(400)
      .json(ERR('INVALID_EVENT', 'kind 非法或缺 agent_id（kind 仅允许 log/upgrade）'));
  }

  const ids: string[] = [];
  for (const n of norm) {
    const ev = n!;
    const r = await pool.query(
      `INSERT INTO zenithjoy.agent_events
         (tenant_id, agent_id, kind, level, module, phase, percent, message, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        tenantId,
        ev.agent_id,
        ev.kind,
        ev.level,
        ev.module,
        ev.phase,
        ev.percent,
        ev.message,
        JSON.stringify(ev.context ?? {}),
      ],
    );
    ids.push(r.rows[0].id);
  }

  if (isBatch) {
    return res.json(OK({ count: ids.length, ids }));
  }
  return res.json(OK({ id: ids[0] }));
});

// ── 2. GET /machines/:id/events — dashboard 读（tenant 隔离 + 分类 logs/upgrades）──
router.get(
  '/machines/:id/events',
  tenantContextOptional,
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json(ERR('NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）'));
    }
    const machineId = req.params.id;

    // :id=agents.id(uuid) → 取该机器 agent_id(text) + tenant 双过滤；不属本租户 → 404
    const m = await pool.query(
      `SELECT agent_id FROM zenithjoy.agents WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [machineId, tenantId],
    );
    if (m.rows.length === 0) {
      return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属于本租户'));
    }
    const agentId = m.rows[0].agent_id as string;

    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;
    const kindFilter =
      typeof req.query.kind === 'string' && VALID_KINDS.includes(req.query.kind)
        ? req.query.kind
        : null;

    // agent 上报 events 时 agent_id 可能用文本 agent_id(ws1-xxx) 或 uuid(agents.id)——两种都匹配
    const params: unknown[] = [tenantId, [agentId, machineId]];
    let kindClause = '';
    if (kindFilter) {
      params.push(kindFilter);
      kindClause = ` AND kind = $${params.length}`;
    }
    params.push(limit);
    const limitParam = `$${params.length}`;

    const r = await pool.query(
      `SELECT id, kind, level, module, phase, percent, message, created_at
         FROM zenithjoy.agent_events
        WHERE tenant_id = $1 AND agent_id = ANY($2)${kindClause}
        ORDER BY created_at DESC
        LIMIT ${limitParam}`,
      params,
    );

    const logs = r.rows
      .filter((row) => row.kind === 'log')
      .map((row) => ({
        id: row.id,
        level: row.level,
        module: row.module,
        message: row.message,
        created_at: row.created_at,
      }));
    const upgrades = r.rows
      .filter((row) => row.kind === 'upgrade')
      .map((row) => ({
        id: row.id,
        module: row.module,
        phase: row.phase,
        percent: row.percent,
        message: row.message,
        created_at: row.created_at,
      }));

    return res.json(OK({ logs, upgrades }));
  },
);

export default router;
export { router as agentEventsRouter };
