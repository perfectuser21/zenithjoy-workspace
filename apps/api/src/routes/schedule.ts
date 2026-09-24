/**
 * 排程看板读写面（task 3abb7f8c）
 *
 *   GET    /api/schedule                 本租户设备未来几天的活 + 额度
 *   POST   /api/schedule/jobs            派一件活（一次性单）
 *   PATCH  /api/schedule/jobs/:id/time   改计划时间（CAS）
 *   POST   /api/schedule/jobs/:id/cancel 取消（留痕，不删）
 *
 * 鉴权与 workers-read 同一把闸：严格 tenantContext（租户只从服务端能解析的身份来，
 * 不接受客户端自报）。Brain tasks 表**没有租户维度**，所以每个端点都必须先用本库
 * agents 取白名单，再按 assigned_to 比对 —— 跨租户一律表现为"不存在"，不是 403
 * （403 等于确认了该资源存在，可被枚举）。
 */
import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { tenantContext } from '../middleware/tenant-context';
import { simpleRateLimit, tenantKeyFn } from '../middleware/simple-rate-limit';
import pool from '../db/connection';
import { getBrainPool } from '../db/brain-pool';
import {
  filterByTenantAgents,
  toScheduleSlot,
  validateWindow,
  isStale,
  buildCasUpdate,
  toDeviceSerial,
  STALE_AFTER_MS,
  type BrainDeviceJob,
  type Dept,
} from '../services/schedule-service';

const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown) => ({ success: true, data });

const DEPTS: Dept[] = ['智能获客', '新媒体部', '私域客服', '视频剪辑'];
/** 对外动作的部门：这些部门的活会碰平台，受铁律 27bb6d1a 的窗口约束 */
const OUTBOUND_DEPTS = new Set<Dept>(['智能获客', '新媒体部', '私域客服']);
// 读面 1 分钟轮询 + 写面是对外动作的扳机，按租户限流。
// 顺序有意为之：**限流排在鉴权之前**，否则未授权的请求照样要消耗一次鉴权开销；
// CodeQL 的 js/missing-rate-limiting 也正是按"授权前有没有限流"判的。
// 同时挂在每条路由上：它不追 router 级 use，挂在路由上才认得出来，也更难被误删。
const rateLimit = simpleRateLimit({ windowMs: 60_000, max: 120, keyFn: tenantKeyFn });

export const scheduleRouter = Router();
scheduleRouter.use(rateLimit);
scheduleRouter.use(tenantContext);

function requireTenant(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) { res.status(401).json(ERR('NO_TENANT', '缺租户上下文')); return null; }
  return t;
}

/** 本租户的设备白名单（agents.id 即控制塔那把钥匙） */
async function tenantAgents(tenantId: string): Promise<
  Array<{ id: string; nickname: string | null; agent_id: string; status: string | null; last_seen: Date | null }>
> {
  const { rows } = await pool.query(
    `SELECT id, nickname, agent_id, status, last_seen
       FROM zenithjoy.agents
      WHERE tenant_id = $1
      ORDER BY nickname NULLS LAST, agent_id`,
    [tenantId],
  );
  return rows;
}

/** 在线判据与实时页同口径：心跳窗口，而不是 status 列自报 */
const ONLINE_WINDOW_MS = 5 * 60_000;
function isOnline(lastSeen: Date | null): boolean {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}

scheduleRouter.get('/', rateLimit, async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const nowIso = new Date().toISOString();
  let agents: Awaited<ReturnType<typeof tenantAgents>> = [];
  try {
    agents = await tenantAgents(tenantId);
  } catch (e) {
    console.error('[schedule] 读本租户设备失败:', e);
    return res.status(500).json(ERR('DB_ERROR', '查询失败'));
  }

  const brain = getBrainPool();
  // 读不到 Brain ≠ 今天没活：stale=true 让页面显示「读取失败 · 数据截至 X」。
  if (!brain) {
    return res.json(OK({
      as_of: nowIso, stale: true, mock: false,
      stale_reason: '未配置 Brain 库连接（BRAIN_DATABASE_HOST）',
      devices: agents.map((a) => ({
        agent_id: a.id, name: a.nickname ?? a.agent_id, serial: toDeviceSerial(a.agent_id),
        online: isOnline(a.last_seen), depts: [], quotas: [], slots: [],
      })),
    }));
  }

  const ids = agents.map((a) => a.id);
  let rows: BrainDeviceJob[] = [];
  let staleReason: string | null = null;
  if (ids.length > 0) {
    try {
      const r = await brain.query(
        `SELECT id, title, task_type, status, dept, assigned_to,
                to_char(due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS due_at,
                row_version, payload
           FROM tasks
          WHERE task_type = 'device_job'
            AND assigned_to = ANY($1::text[])
            AND (due_at IS NULL OR due_at > NOW() - INTERVAL '2 days')
          ORDER BY due_at NULLS LAST
          LIMIT 2000`,
        [ids],
      );
      rows = r.rows as BrainDeviceJob[];
    } catch (e) {
      console.error('[schedule] 跨境读 Brain 失败:', e);
      staleReason = '读取排程后台失败';
    }
  }

  // 双保险：SQL 已按 assigned_to 收窄，这里再过一道白名单。
  // Brain 表无租户维度，多一道纯函数闸比省一次遍历值钱。
  const mine = filterByTenantAgents(rows, ids);
  const byAgent = new Map<string, BrainDeviceJob[]>();
  for (const r of mine) {
    const k = r.assigned_to as string;
    if (!byAgent.has(k)) byAgent.set(k, []);
    byAgent.get(k)!.push(r);
  }

  const devices = agents.map((a) => {
    const slots = (byAgent.get(a.id) ?? []).map(toScheduleSlot);
    const depts = Array.from(new Set(slots.map((s) => s.dept)));
    return {
      agent_id: a.id,
      name: a.nickname ?? a.agent_id,
      // 读面吐给页面的也必须是裸序列号：页面会拿它往下传，带着 phone- 前缀
      // 工作机认不出（生产实证：单 03aa758d "unknown phone profile: phone-…"）
      serial: toDeviceSerial(a.agent_id),
      online: isOnline(a.last_seen),
      depts,
      // 额度真身仍在 Mac 本地（dm-count-*.txt），未上移前这里显式给空，
      // 并由 quotas_stale 标出来 —— 不拿假数字冒充真额度。
      quotas: [],
      quotas_stale: true,
      slots,
    };
  });

  return res.json(OK({
    as_of: nowIso,
    stale: staleReason !== null || isStale(nowIso, Date.now(), STALE_AFTER_MS),
    stale_reason: staleReason,
    mock: false,
    devices,
  }));
});

/** 派一件活（一次性单）。返回创建的任务 id。 */
scheduleRouter.post('/jobs', rateLimit, async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const { agent_id, dept, title, window_start, window_end, est_minutes, idempotency_key, params } =
    req.body ?? {};

  if (!agent_id || typeof agent_id !== 'string') return res.status(400).json(ERR('BAD_AGENT', '缺设备'));
  if (!DEPTS.includes(dept)) return res.status(400).json(ERR('BAD_DEPT', `部门必须是 ${DEPTS.join(' / ')}`));
  if (!title || typeof title !== 'string') return res.status(400).json(ERR('BAD_TITLE', '缺活的名称'));
  if (typeof window_start !== 'string' || typeof window_end !== 'string') {
    return res.status(400).json(ERR('BAD_WINDOW', '缺时间窗口'));
  }
  const ws = Date.parse(window_start); const we = Date.parse(window_end);
  if (Number.isNaN(ws) || Number.isNaN(we)) return res.status(400).json(ERR('BAD_WINDOW', '时间窗口格式非法'));
  if (ws < Date.now() - 60_000) return res.status(400).json(ERR('WINDOW_PAST', '窗口落在过去'));

  const kind = OUTBOUND_DEPTS.has(dept as Dept) ? 'outbound' : 'internal';
  const v = validateWindow({ kind, windowMs: we - ws });
  if (!v.ok) return res.status(400).json(ERR('WINDOW_TOO_TIGHT', v.reason));

  const agents = await tenantAgents(tenantId).catch(() => []);
  const target = agents.find((a) => a.id === agent_id);
  // 跨租户表现为"不存在"，不是 403 —— 403 会确认资源存在，可被枚举。
  if (!target) return res.status(404).json(ERR('NOT_FOUND', '设备不存在'));

  const brain = getBrainPool();
  if (!brain) return res.status(503).json(ERR('BRAIN_UNAVAILABLE', '排程后台未连通（缺 BRAIN_DATABASE_HOST），暂时不能派单'));

  // 窗口内挑一个不规律的落点：固定整点/固定间隔=向平台自首（铁律 27bb6d1a）。
  const plannedAt = new Date(ws + Math.floor(Math.random() * Math.max(1, we - ws))).toISOString();
  const key = typeof idempotency_key === 'string' && idempotency_key ? idempotency_key : randomUUID();

  try {
    // 幂等：同一 key 重复提交（跨境 8 秒超时后的重试）只留一条。
    const dup = await brain.query(
      `SELECT id FROM tasks WHERE task_type='device_job' AND payload->>'idempotency_key' = $1 LIMIT 1`,
      [key],
    );
    if (dup.rows.length > 0) return res.json(OK({ id: dup.rows[0].id, deduped: true }));

    const payload = {
      // headed_manual 是防 tick 抢跑的第一道闸（第二道是 dispatch 黑名单，cecelia PR#5452）。
      // 少了它，这条活会被 Brain 的 tick 派给 LLM 执行体真的去"跑一轮采收"。
      headed_manual: true,
      source: 'oneoff',
      tenant_id: tenantId,
      // 领单器按机身序列号认领（它在工作机上，手边只有 adb devices 的序列号，
      // 没有中台的 agent UUID）。这个字段是派单与真机之间唯一的握手，所以必须存
      // **adb 看得到的那个形态** —— agents.agent_id 是 `phone-<序列号>`，直接存进来
      // 会和领单器发的裸序列号对不上，单子永远领不走（生产实证 550326e5）。
      serial: toDeviceSerial(target.agent_id),
      window_start, window_end,
      idempotency_key: key,
      est_minutes: typeof est_minutes === 'number' ? est_minutes : 15,
      updated_by: tenantId,
      params: params && typeof params === 'object' ? params : {},
    };
    // trigger_source 必须显式标成人工来源。tasks.trigger_source 的库默认值是 'brain_auto'，
    // 而 Brain 的 escalation「优雅降级」会在压力下暂停低优先级的**系统自产**任务
    // （trigger_source ∈ SYSTEM_AUTO_TRIGGER_SOURCES，含 brain_auto）。不标的话，主理人
    // 手动派的活会被归进系统自产桶、静默变成 paused，而领单器只认 queued —— 这条活
    // 从此谁也不跑，页面上看着像排着却永远不动。
    // 生产实证：单 0f6f26e3 被 [Escalation] Paused，error_message=escalation_graceful_degrade。
    const { rows } = await brain.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, dept, assigned_to, due_at, payload, trigger_source)
       VALUES ($1, $2, 'device_job', 'queued', 'P2', $3, $4, $5, $6::jsonb, $7)
       RETURNING id, row_version`,
      [title, `工作机页派单 · ${dept}`, dept, agent_id, plannedAt, JSON.stringify(payload), 'manual'],
    );
    return res.status(201).json(OK({ id: rows[0].id, row_version: rows[0].row_version, planned_at: plannedAt }));
  } catch (e) {
    console.error('[schedule] 派单失败:', e);
    return res.status(500).json(ERR('DISPATCH_FAILED', '派单失败'));
  }
});

/** 改计划时间（乐观锁 CAS，不匹配返回 409 并附当前值） */
scheduleRouter.patch('/jobs/:id/time', rateLimit, async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const { planned_at, row_version } = req.body ?? {};
  if (typeof planned_at !== 'string' || Number.isNaN(Date.parse(planned_at))) {
    return res.status(400).json(ERR('BAD_TIME', '计划时间格式非法'));
  }
  if (Date.parse(planned_at) < Date.now() - 60_000) return res.status(400).json(ERR('TIME_PAST', '不能改到过去'));
  if (!Number.isInteger(row_version)) return res.status(400).json(ERR('BAD_VERSION', '缺版本号'));

  const brain = getBrainPool();
  if (!brain) return res.status(503).json(ERR('BRAIN_UNAVAILABLE', '排程后台未连通，暂时不能改时间'));

  try {
    const agents = await tenantAgents(tenantId);
    const ids = agents.map((a) => a.id);
    const owned = await brain.query(
      `SELECT id, status, row_version, payload FROM tasks
        WHERE id = $1 AND task_type='device_job' AND assigned_to = ANY($2::text[])`,
      [req.params.id, ids],
    );
    if (owned.rows.length === 0) return res.status(404).json(ERR('NOT_FOUND', '这条活不存在'));

    // 真机自发的活（cron 触发）在页面上是只读镜像：它的执行由手机上的 cron 决定，
    // 改这里的 due_at 或 status 对真机零作用。放行 = 让运营以为取消了，手机照跑。
    if ((owned.rows[0].payload ?? {}).read_only === true) {
      return res.status(409).json(ERR('READ_ONLY_JOB',
        '这是工作机自发执行的活（cron 触发），页面上只能看不能改；要停它得去对应工作机停 cron'));
    }

    const { sql, params } = buildCasUpdate({ taskId: req.params.id, rowVersion: row_version, dueAt: planned_at });
    const r = await brain.query(sql, params);
    if (r.rows.length === 0) {
      const cur = owned.rows[0];
      // 分清两种失败：已经开跑 vs 被别人改过。含糊的 409 会让人反复重试同一个错误动作。
      const reason = cur.status !== 'queued'
        ? `这条活已经是「${cur.status}」，不能再改时间`
        : '这条活刚被改过，请基于最新值重试';
      return res.status(409).json({ ...ERR('CONFLICT', reason), current: { status: cur.status, row_version: cur.row_version } });
    }
    return res.json(OK({ id: r.rows[0].id, row_version: r.rows[0].row_version, planned_at: r.rows[0].due_at }));
  } catch (e) {
    console.error('[schedule] 改时间失败:', e);
    return res.status(500).json(ERR('UPDATE_FAILED', '改时间失败'));
  }
});

/** 取消（标记留痕，不删行 —— 主理人要求所有活必须留痕） */
scheduleRouter.post('/jobs/:id/cancel', rateLimit, async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const brain = getBrainPool();
  if (!brain) return res.status(503).json(ERR('BRAIN_UNAVAILABLE', '排程后台未连通，暂时不能取消'));
  try {
    const agents = await tenantAgents(tenantId);
    const ids = agents.map((a) => a.id);

    const owned = await brain.query(
      `SELECT id, status, row_version, payload FROM tasks
        WHERE id = $1 AND task_type='device_job' AND assigned_to = ANY($2::text[])`,
      [req.params.id, ids],
    );
    // 真机自发的活（cron 触发）在页面上是只读镜像：它的执行由手机上的 cron 决定，
    // 改这里的 due_at 或 status 对真机零作用。放行 = 让运营以为取消了，手机照跑。
    if (owned.rows.length > 0 && (owned.rows[0].payload ?? {}).read_only === true) {
      return res.status(409).json(ERR('READ_ONLY_JOB',
        '这是工作机自发执行的活（cron 触发），页面上只能看不能改；要停它得去对应工作机停 cron'));
    }

    const r = await brain.query(
      `UPDATE tasks
          SET status = 'cancelled',
              row_version = row_version + 1,
              updated_at = NOW(),
              payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('cancelled_by', $3::text, 'cancelled_at', NOW()::text)
        WHERE id = $1
          AND task_type = 'device_job'
          AND assigned_to = ANY($2::text[])
          AND status = 'queued'
        RETURNING id, row_version`,
      [req.params.id, ids, tenantId],
    );
    if (r.rows.length === 0) return res.status(409).json(ERR('CANNOT_CANCEL', '这条活不存在或已经开跑/已结束'));
    return res.json(OK({ id: r.rows[0].id, row_version: r.rows[0].row_version }));
  } catch (e) {
    console.error('[schedule] 取消失败:', e);
    return res.status(500).json(ERR('CANCEL_FAILED', '取消失败'));
  }
});

export default scheduleRouter;
