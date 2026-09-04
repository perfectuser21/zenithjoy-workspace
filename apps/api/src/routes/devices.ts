/**
 * OpenClaw 信号桥·件2 — 设备指令桥（决策 7a4c0369，系列件2/3）
 *   POST /api/devices/:agentId/actions   下发单条设备原语并同步等待回执
 *
 * 数据流：限流(先于鉴权,CodeQL) → prod 缺内部 token 守卫(503) → internalAuth
 *   → agents.tenant_id 推导租户(绝不信请求体) → remote_control_config 开关(fail-closed)
 *   → action 白名单(8) → 频控原子 INSERT pending 行 → 版本检查 → CommandBridge 下发等待
 *   → 回执映射 + log UPDATE。
 *
 * 鉴权红线（prep-prd 对抗 P1-3/P1-4）：只走 internalAuth，刻意砍掉 agent license
 * 路径——调用方是件3 phonectl/内部编排；license 被客户手机提取即可横向驱动同租户
 * 全部设备（含 screenshot 读屏），是负资产。internalAuth 原生 fail-open（env 缺失
 * dev 放行），production 必须包死：无 ZENITHJOY_INTERNAL_TOKEN → 503 拒服务。
 *
 * 504 语义：DEVICE_TIMEOUT = 结果未知（outcome:'unknown'），设备无取消机制，指令在
 * 设备队列里照样执行。调用方禁止盲重试；用同 idempotencyKey 重发天然吃设备端 done
 * 缓存实现"结果重取"（件1 能力）。
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { internalAuth } from '../middleware/internal-auth';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import { agentRegistry } from '../services/agent-registry';
import { commandBridge, clampTimeoutMs, CommandBridgeError } from '../services/command-bridge';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown) => ({ success: true, data });

/** 件1 设备端 CommandProtocol 的 8 个已知 action，未知一律 400 不透传 */
const ACTION_WHITELIST = new Set([
  'screenshot', 'tap', 'swipe', 'type', 'key', 'launch', 'device_info', 'tree_dump',
]);
/** 双闸动作：除总闸外还吃 taps_per_minute（防高频点击风控） */
const TAP_ACTIONS = new Set(['tap', 'swipe']);

/** 开关缺省语义（判定点登记表）：无配置行 = 开（Alex 拍板）；fail-closed 只对故障态 */
const CONFIG_DEFAULTS = { enabled: true, actions_per_minute: 60, taps_per_minute: 30 };

function requireAgentUuid(req: Request, res: Response, next: NextFunction) {
  if (!UUID_RE.test(req.params.agentId ?? '')) {
    return res.status(400).json(ERR('INVALID_AGENT_ID', 'agent id 须为 uuid（zenithjoy.agents.id）'));
  }
  next();
}

/**
 * production 环境 ZENITHJOY_INTERNAL_TOKEN 未配置 → 直接拒服务。
 * internalAuth 在 env 缺失时是放行的（dev 友好），对远程控制设备这个面 fail-open
 * 不可接受，必须包一层守卫（配 proven-to-fire 测试）。
 */
function prodTokenGuard(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production' && !process.env.ZENITHJOY_INTERNAL_TOKEN) {
    return res.status(503).json(ERR('SERVICE_UNAVAILABLE', 'ZENITHJOY_INTERNAL_TOKEN 未配置，设备指令桥拒绝服务'));
  }
  next();
}

/**
 * 件1 能力判据（实查结论，2026-09-04）：
 *  - registry entry.meta 只有 hello 带来的 {capabilities, version}；
 *  - 设备端 hello 的 capabilities 恒为 ["android"]（WsClient.kt buildHelloPayload，
 *    件1 没往里加 'cmd'）；
 *  - 件1（PR#1762）合并时 versionName 停在 2.1.47 没有 bump——2.1.47 是上墙推流
 *    （PR#1750）的版本号，因此「2.1.47」二义：可能含件1 也可能不含。
 * 判据定为：capabilities 含 'cmd'（未来设备端加上后的逃生口/权威信号）或
 * version >= 2.1.48（下一次发版起必含件1）。2.1.47 按无能力处理——旧 agent 对 cmd
 * 静默丢弃，快速 409 优于白烧 35s 超时预算（fail fast）。
 */
export function agentSupportsCmd(meta: { capabilities: string[]; version: string }): boolean {
  if (meta.capabilities.includes('cmd')) return true;
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b, c] = parse(meta.version);
  const [x, y, z] = [2, 1, 48];
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
}

export const devicesRouter = Router();

// CodeQL js/missing-rate-limiting：限流先于鉴权，且挂在具体 route（router.use 层
// req.params 恒空——workers-executor 的潜伏 bug 不复制）。这是粗闸（防打爆进程），
// 真业务频控在下面 device_command_log 原子窗口计数。
const actionsRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 300,
  keyFn: (req: Request) => req.params.agentId || ipKeyFn(req),
});

devicesRouter.post(
  '/:agentId/actions',
  requireAgentUuid,
  actionsRateLimit,
  prodTokenGuard,
  internalAuth,
  async (req: Request, res: Response) => {
    const agentId = req.params.agentId;
    const body: Record<string, unknown> = req.body ?? {};
    const { action, timeoutMs, idempotencyKey, ...rest } = body;
    // tenant_id 等一律不从请求体取（对抗 P2）：从 args 里剔掉，也绝不进任何判定
    delete (rest as Record<string, unknown>).tenant_id;

    // ── 1. action 白名单 ──────────────────────────────────────────────
    if (typeof action !== 'string' || !ACTION_WHITELIST.has(action)) {
      return res.status(400).json(ERR('UNKNOWN_ACTION', `action 须为：${[...ACTION_WHITELIST].join('/')}`));
    }
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !UUID_RE.test(idempotencyKey))) {
      return res.status(400).json(ERR('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey 须为 uuid'));
    }

    // ── 2. 按 :agentId 推导租户（tenant 绝不信请求体）────────────────
    let tenantId: string | null;
    try {
      const r = await pool.query('SELECT tenant_id FROM zenithjoy.agents WHERE id = $1', [agentId]);
      if (!r.rows || r.rows.length === 0) {
        return res.status(404).json(ERR('AGENT_NOT_FOUND', 'agent 不存在（zenithjoy.agents.id）'));
      }
      tenantId = r.rows[0].tenant_id;
    } catch (e) {
      console.error('[devices] agent lookup failed:', e);
      return res.status(503).json(ERR('AGENT_LOOKUP_FAILED', 'agent 查询失败，拒绝下发'));
    }
    if (!tenantId) {
      return res.status(404).json(ERR('AGENT_NOT_FOUND', 'agent 无租户归属'));
    }

    // ── 3. 租户远程协助开关（fail-closed：查询异常 = 拒绝）───────────
    let config = CONFIG_DEFAULTS;
    try {
      const r = await pool.query(
        'SELECT enabled, actions_per_minute, taps_per_minute FROM zenithjoy.remote_control_config WHERE tenant_id = $1',
        [tenantId]
      );
      if (r.rows && r.rows.length > 0) {
        config = { ...CONFIG_DEFAULTS, ...r.rows[0] };
      }
    } catch (e) {
      console.error('[devices] remote_control_config lookup failed:', e);
      return res.status(503).json(ERR('CONFIG_LOOKUP_FAILED', '远程协助开关查询失败，拒绝下发（fail-closed）'));
    }
    if (!config.enabled) {
      return res.status(403).json(ERR('REMOTE_CONTROL_DISABLED', '该租户已关闭远程协助'));
    }

    // ── 4. 频控：单条原子 INSERT...SELECT WHERE count<limit 写 pending 行 ──
    // count 含 pending 行（对抗 P1-5 TOCTOU）；screenshot 计入总闸（防免费投屏）；
    // tap/swipe 双闸。log 不落 args（隐私优先，审计只到 action 名）。
    const msgId = (idempotencyKey as string | undefined) ?? crypto.randomUUID();
    const isTap = TAP_ACTIONS.has(action);
    try {
      const ins = await pool.query(
        `INSERT INTO zenithjoy.device_command_log (tenant_id, agent_id, msg_id, action, status)
         SELECT $1, $2, $3, $4, 'pending'
          WHERE (SELECT count(*) FROM zenithjoy.device_command_log
                  WHERE tenant_id = $1 AND agent_id = $2
                    AND created_at > now() - interval '1 minute') < $5
            AND (NOT $6::boolean OR (SELECT count(*) FROM zenithjoy.device_command_log
                  WHERE tenant_id = $1 AND agent_id = $2 AND action IN ('tap','swipe')
                    AND created_at > now() - interval '1 minute') < $7)
         ON CONFLICT (msg_id) DO NOTHING
         RETURNING id`,
        [tenantId, agentId, msgId, action, config.actions_per_minute, isTap, config.taps_per_minute]
      );
      if (!ins.rowCount) {
        // 没插进去：要么超限，要么 idempotencyKey 重发撞 UNIQUE（复用既有行，不新 INSERT）
        const existing = await pool.query(
          'SELECT msg_id FROM zenithjoy.device_command_log WHERE msg_id = $1', [msgId]
        );
        if (!existing.rows || existing.rows.length === 0) {
          return res.status(429).json(ERR('RATE_LIMITED',
            `频控超限（${config.actions_per_minute} 次/分钟${isTap ? `，tap/swipe ${config.taps_per_minute} 次/分钟` : ''}）`));
        }
        // 同 key 重发 → 复用行，设备端去重缓存会直接回 done 结果（结果重取）
      }
    } catch (e) {
      console.error('[devices] rate-limit insert failed:', e);
      return res.status(503).json(ERR('RATE_CHECK_FAILED', '频控写入失败，拒绝下发（fail-closed）'));
    }

    const updateLog = (status: string, ok: boolean | null, errorCode: string | null, latencyMs: number | null) =>
      pool.query(
        'UPDATE zenithjoy.device_command_log SET status = $2, ok = $3, error_code = $4, latency_ms = $5 WHERE msg_id = $1',
        [msgId, status, ok, errorCode, latencyMs]
      ).catch((e) => console.warn('[devices] log update failed:', e));

    // ── 5. 版本检查：旧 agent 对 cmd 静默丢弃，快速 409 不白烧 35s ────
    const entry = agentRegistry.get(agentId);
    if (!entry) {
      await updateLog('rejected', null, 'NOT_CONNECTED', null);
      return res.status(503).json(ERR('NOT_CONNECTED', '设备不在线（ws0 无连接）'));
    }
    if (!agentSupportsCmd(entry.meta)) {
      await updateLog('rejected', null, 'AGENT_TOO_OLD', null);
      return res.status(409).json(ERR('AGENT_TOO_OLD',
        `agent 版本 ${entry.meta.version} 无件1 指令能力（需 capabilities 含 cmd 或版本 ≥2.1.48），请先 OTA`));
    }

    // ── 6. 下发并等待回执 ────────────────────────────────────────────
    const startedAt = Date.now();
    try {
      const result = await commandBridge.dispatchAndWait(
        agentId, action, rest, clampTimeoutMs(typeof timeoutMs === 'number' ? timeoutMs : undefined), msgId
      );
      const latency = Date.now() - startedAt;
      await updateLog('done', result.ok ?? null, result.errorCode ?? null, latency);
      return res.json(OK({
        ok: result.ok,
        errorCode: result.errorCode,
        foregroundPkg: result.foregroundPkg,
        data: result.data,
        outcome: 'completed',
      }));
    } catch (e) {
      const code = (e as CommandBridgeError)?.code;
      if (code === 'DEVICE_TIMEOUT') {
        await updateLog('timeout', null, 'DEVICE_TIMEOUT', null);
        // 结果未知 ≠ 未执行：设备无取消机制，指令可能仍在队列里执行。禁止盲重试。
        return res.status(504).json({ ...ERR('DEVICE_TIMEOUT', '等待设备回执超时——结果未知，禁止盲重试（可用同 idempotencyKey 重取结果）'), outcome: 'unknown' });
      }
      if (code === 'DEVICE_BUSY') {
        await updateLog('rejected', null, 'DEVICE_BUSY', null);
        return res.status(409).json(ERR('DEVICE_BUSY', '该设备已有在途指令（每设备同时 1 条）'));
      }
      if (code === 'NOT_CONNECTED') {
        await updateLog('rejected', null, 'NOT_CONNECTED', null);
        return res.status(503).json(ERR('NOT_CONNECTED', '设备不在线（ws0 不可达）'));
      }
      if (code === 'AGENT_DISCONNECTED') {
        await updateLog('failed', null, 'AGENT_DISCONNECTED', null);
        return res.status(502).json(ERR('AGENT_DISCONNECTED', '等待回执期间设备连接断开'));
      }
      console.error('[devices] dispatch failed:', e);
      await updateLog('failed', null, 'INTERNAL_ERROR', null);
      return res.status(500).json(ERR('INTERNAL_ERROR', '内部错误'));
    }
  }
);

export default devicesRouter;
