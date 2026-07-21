/**
 * 机器管理路由 — Path 2 机器管理
 *
 * 契约：sprints/06260400-machine-management/contract.md
 * 扩展：sprints/07202259-xian-runner-fleet/contract.md（owner_type 双维度展示）
 *   GET    /api/agent/machines           列机器（tenant 隔离 + session_count + owner_type 过滤）
 *   GET    /api/agent/machines/:id        机器详情 + 抖音号列表
 *   PUT    /api/agent/machines/:id        改 nickname / machine_role / owner_type
 *
 * ?owner_type=internal_fleet|customer  可选过滤（机器管理页双 tab 用）
 *
 * tenant 隔离复刻 agent-burner.ts：挂 tenantContextOptional，租户从 req.tenantId 取
 *   - dashboard：better-auth session（cookie）服务端解析 → 安全，前端不传 tenant
 *   - smoke / 非浏览器 caller：传 X-Tenant-Id 头
 * 绝不信客户端 query.tenant_id（越权风险）。无 session 且无头 → tenantContext 返回 401。
 * agent_platform_sessions.agent_id 存的是 agents.id(uuid)，故关联用 a.id = s.agent_id。
 */
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContextOptional } from '../middleware/tenant-context';
import { simpleRateLimit, tenantKeyFn } from '../middleware/simple-rate-limit';

const router = Router();

// 所有机器管理端点统一从已认证上下文解析租户（session / X-Tenant-Id 头）
router.use(tenantContextOptional);
// CodeQL js/missing-rate-limiting：机器管理路由碰 DB，按 tenant 限流（60次/分钟）
router.use(simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: tenantKeyFn }));

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

const VALID_ROLES = ['main', 'sub'];

const VALID_OWNER_TYPES = ['internal_fleet', 'customer'] as const;
type OwnerType = typeof VALID_OWNER_TYPES[number];

// session_count 由 pg COUNT 返回字符串，统一转 number
// offline_minutes: 在线时 null，离线时 = Math.floor((now - last_seen_ms) / 60000)
function normMachine(row: Record<string, unknown>) {
  const status =
    typeof row.status === 'string'
      ? row.status
      : row.last_seen &&
          Date.now() - new Date(row.last_seen as string).getTime() <=
            3 * 60 * 1000
        ? 'online'
        : 'offline';

  let offlineMinutes: number | null = null;
  if (status !== 'online' && row.last_seen) {
    const lastSeenMs = new Date(row.last_seen as string).getTime();
    offlineMinutes = Math.floor((Date.now() - lastSeenMs) / 60000);
  }

  return {
    id: row.id,
    agent_id: row.agent_id,
    hostname: row.hostname,
    nickname: row.nickname,
    machine_role: row.machine_role,
    os_type: row.os_type ?? null,
    owner_type: (row.owner_type as OwnerType) ?? 'customer',
    status,
    version: row.version,
    last_seen: row.last_seen,
    session_count: Number(row.session_count ?? 0),
    offline_minutes: offlineMinutes,
  };
}

// ── 1. GET /machines — 列机器 + session_count（LEFT JOIN COUNT）──
// ?owner_type=internal_fleet|customer  可选过滤（机器管理页双 tab 用）
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json(ERR("NO_TENANT", "缺租户上下文（未登录或无 X-Tenant-Id）"));
  }

  // 可选 owner_type 过滤；非法值静默忽略（返回全量）
  const ownerTypeFilter = typeof req.query.owner_type === 'string' &&
    VALID_OWNER_TYPES.includes(req.query.owner_type as OwnerType)
    ? (req.query.owner_type as OwnerType)
    : null;

  const params: unknown[] = [tenantId];
  const ownerTypeClause = ownerTypeFilter
    ? ` AND a.owner_type = $${params.push(ownerTypeFilter)}`
    : '';

  try {
    const r = await pool.query(
      `SELECT a.id, a.agent_id, a.hostname, a.nickname, a.machine_role,
              a.os_type, a.owner_type,
              CASE WHEN a.last_seen > NOW() - INTERVAL '3 minutes'
                   THEN 'online' ELSE 'offline' END AS status,
              a.version, a.last_seen,
              COUNT(s.id) AS session_count
         FROM zenithjoy.agents a
         LEFT JOIN zenithjoy.agent_platform_sessions s ON s.agent_id = a.id
        WHERE a.tenant_id = $1${ownerTypeClause}
        GROUP BY a.id
        ORDER BY (a.last_seen > NOW() - INTERVAL '3 minutes') DESC, a.hostname ASC`,
      params,
    );
    return res.json(OK(r.rows.map(normMachine)));
  } catch (e) {
    console.error('[agent-machines] GET / error:', e);
    return res.status(500).json(ERR('DB_ERROR', '查询失败'));
  }
});

// ── 2. GET /machines/:id — 机器详情 + 抖音号列表 ──
router.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const machineId = req.params.id;

  try {
    const m = await pool.query(
      `SELECT a.id, a.agent_id, a.hostname, a.nickname, a.machine_role,
              a.os_type, a.owner_type,
              a.status, a.version, a.last_seen,
              COUNT(s.id) AS session_count
         FROM zenithjoy.agents a
         LEFT JOIN zenithjoy.agent_platform_sessions s ON s.agent_id = a.id
        WHERE a.id = $1 AND a.tenant_id = $2
        GROUP BY a.id`,
      [machineId, tenantId || null],
    );
    if (m.rows.length === 0) {
      return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属于本租户'));
    }

    const s = await pool.query(
      `SELECT s.account_label, s.role, s.status, s.platform, s.bound_at,
              (SELECT response->>'account_nickname'
                 FROM zenithjoy.publish_tasks
                WHERE agent_id=s.agent_id
                  AND task_type='qr_bind/douyin_burner'
                  AND payload->>'account_label' = s.account_label
                ORDER BY created_at DESC LIMIT 1) AS account_nickname
         FROM zenithjoy.agent_platform_sessions s
        WHERE s.agent_id = $1
        ORDER BY s.bound_at DESC NULLS LAST, s.account_label ASC`,
      [machineId],
    );

    return res.json(
      OK({
        machine: normMachine(m.rows[0]),
        sessions: s.rows,
      }),
    );
  } catch (e) {
    console.error('[agent-machines] GET /:id error:', e);
    return res.status(500).json(ERR('DB_ERROR', '查询失败'));
  }
});

// ── 3. PUT /machines/:id — 改 nickname / machine_role ──
router.put('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const machineId = req.params.id;
  const { nickname, machine_role, owner_type } = req.body || {};

  const hasNickname = nickname !== undefined;
  const hasRole = machine_role !== undefined;
  const hasOwnerType = owner_type !== undefined;

  if (!hasNickname && !hasRole && !hasOwnerType) {
    return res.status(400).json(ERR('NO_UPDATE_FIELDS', 'nickname / machine_role / owner_type 至少传一个'));
  }
  if (hasRole && !VALID_ROLES.includes(machine_role)) {
    return res
      .status(400)
      .json(ERR('INVALID_MACHINE_ROLE', `machine_role 取值非法，仅允许 ${VALID_ROLES.join('/')}`));
  }
  if (hasOwnerType && !VALID_OWNER_TYPES.includes(owner_type)) {
    return res
      .status(400)
      .json(ERR('INVALID_OWNER_TYPE', `owner_type 取值非法，仅允许 ${VALID_OWNER_TYPES.join('/')}`));
  }

  // 动态拼 SET 子句（仅更新传入字段）
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (hasNickname) {
    sets.push(`nickname = $${i++}`);
    params.push(nickname);
  }
  if (hasRole) {
    sets.push(`machine_role = $${i++}`);
    params.push(machine_role);
  }
  if (hasOwnerType) {
    sets.push(`owner_type = $${i++}`);
    params.push(owner_type);
  }
  sets.push('updated_at = NOW()');

  const idParam = i++;
  const tenantParam = i++;
  params.push(machineId, tenantId || null);

  try {
    const upd = await pool.query(
      `UPDATE zenithjoy.agents
          SET ${sets.join(', ')}
        WHERE id = $${idParam} AND tenant_id = $${tenantParam}
        RETURNING id, agent_id, hostname, nickname, machine_role, os_type, owner_type, status, version, last_seen`,
      params,
    );
    if (upd.rows.length === 0) {
      return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属于本租户'));
    }

    // 更新后机器对象不带 session_count 列；契约要求返回「更新后机器对象」，补 0 占位由前端重拉刷新
    return res.json(OK(normMachine(upd.rows[0])));
  } catch (e) {
    console.error('[agent-machines] PUT /:id error:', e);
    return res.status(500).json(ERR('DB_ERROR', '更新失败'));
  }
});

export default router;
export { router as agentMachinesRouter };
