/**
 * 排程读写服务 —— 工作机页「未来的活」的数据面（task 3abb7f8c）
 *
 * 真身在 us-vps 的 Brain（`public.tasks` 里 task_type='device_job'），中台只做读面与写入代理：
 * 决策 e1ec93b2「Brain tasks = 唯一真身」，中台不另建一张会分叉的排程表。
 *
 * 三条不能破的线：
 *  1. **租户隔离靠中台自己**：Brain tasks 表没有租户维度（tenant_id 只躺在 payload 里），
 *     直出就是悦升租户能看见金诺机的活。一律先用本库 agents 取白名单，再按 assigned_to 过滤。
 *  2. **跨境读必须能失败得明明白白**：hk-vps→us-vps 跨境，3 秒不够（PR#1892 的丢单教训），
 *     给 8 秒；读不到时 payload 带 stale=true，页面显示"读取失败"，绝不渲染成"今天没活"。
 *  3. **写入走 CAS**：页面与 Notion 两处都能改同一条，必须带 row_version 判态
 *     （invariant 761f242b：SELECT 判态再 UPDATE 一律升级为 UPDATE ... WHERE）。
 *     不能用 updated_at —— 它被 Brain 的 tick 定时 touch，当锁会假冲突刷屏 + 真冲突漏判。
 */

export type Dept = '智能获客' | '新媒体部' | '私域客服' | '视频剪辑';
export type SlotStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked';

/** Brain `public.tasks` 里一行 device_job 的取数形状 */
export interface BrainDeviceJob {
  id: string;
  title: string;
  task_type: string;
  status: string;
  dept: string | null;
  assigned_to: string | null;
  due_at: string | null;
  row_version: number;
  payload: Record<string, unknown>;
}

export interface ScheduleSlotOut {
  id: string;
  title: string;
  dept: Dept;
  planned_at: string;
  window_start: string | null;
  window_end: string | null;
  executed_at: string | null;
  est_minutes: number;
  status: SlotStatus;
  source: 'recurring' | 'oneoff';
  row_version: number;
  updated_by: string | null;
  blocked_reason?: string;
  /** 真机自发的活（cron 触发）只能看不能改：source 会被下面那行降级成 'oneoff'，
   *  前端靠这个字段单独判断能不能出现改时间/取消按钮。 */
  read_only: boolean;
}

export interface QuotaIn {
  dept: Dept;
  used: number;
  cap: number;
  unit: string;
}

/** 跨境读 Brain 的超时：3 秒不够（PR#1892 实证），关键读写一律 8 秒 */
export const BRAIN_READ_TIMEOUT_MS = 8_000;
/** 排程数据多久没更新就算陈旧（主理人拍板 15 分钟） */
export const STALE_AFTER_MS = 15 * 60_000;
/** 对外动作的最小窗口宽度（铁律 27bb6d1a） */
export const MIN_OUTBOUND_WINDOW_MS = 30 * 60_000;

/**
 * 按本租户的 agent 白名单过滤 Brain 取回的活。
 *
 * 精确相等匹配，绝不做前缀/包含 —— 否则截断的 id 片段就能捞到别家的活。
 * `assigned_to` 为空的孤儿单不算任何租户的：宁可看不见，也不能泄漏给所有人。
 */
export function filterByTenantAgents(
  rows: BrainDeviceJob[],
  allowedAgentIds: string[],
): BrainDeviceJob[] {
  const allow = new Set(allowedAgentIds);
  return rows.filter((r) => typeof r.assigned_to === 'string' && allow.has(r.assigned_to));
}

const STATUS_MAP: Record<string, SlotStatus> = {
  queued: 'queued',
  in_progress: 'running',
  completed: 'done',
  failed: 'failed',
  blocked: 'blocked',
};

/** Brain 一行 → 页面一条。未知状态落 blocked 并带上原状态，不静默变成"待跑"骗人。 */
export function toScheduleSlot(row: BrainDeviceJob): ScheduleSlotOut {
  const p = row.payload ?? {};
  const mapped = STATUS_MAP[row.status];
  const status: SlotStatus = mapped ?? 'blocked';
  const plannedAt = row.due_at ? new Date(row.due_at).toISOString() : new Date(0).toISOString();
  const out: ScheduleSlotOut = {
    id: row.id,
    title: row.title,
    dept: (row.dept as Dept) ?? '智能获客',
    planned_at: plannedAt,
    window_start: typeof p.window_start === 'string' ? p.window_start : null,
    window_end: typeof p.window_end === 'string' ? p.window_end : null,
    executed_at: typeof p.executed_at === 'string' ? p.executed_at : null,
    est_minutes: typeof p.est_minutes === 'number' ? p.est_minutes : 15,
    status,
    source: p.source === 'recurring' ? 'recurring' : 'oneoff',
    row_version: Number(row.row_version ?? 0),
    updated_by: typeof p.updated_by === 'string' ? p.updated_by : null,
    // 真机自发的活（cron 触发）只能看不能改：改这里的 due_at/status 对手机零作用。
    // source 字段会被上面那行降级成 'oneoff'，所以必须单独透一个标记出去。
    read_only: p.read_only === true,
  };
  if (!mapped) out.blocked_reason = `未识别的后台状态：${row.status}`;
  return out;
}

/**
 * 每条业务线各算各的余量。
 *
 * 绝不跨部门加总：一台机既做获客又做发布时，把两条线的余量合成一个"还能加 N"，
 * 主理人会拿同一份余量派两遍。
 */
export function quotaHeadroomByDept(quotas: QuotaIn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of quotas) out[q.dept] = Math.max(0, q.cap - q.used);
  return out;
}

/**
 * 窗口宽度校验。
 *
 * 主理人要的是控制权（"我说了算、我能看到它照办"），不是分钟级精度；而平台风控
 * 最容易抓的正是固定整点、固定间隔。所以对外动作（私信/发布/点赞）在页面上排的
 * 是一个窗口，系统在窗口内挑不规律的点去跑；对内动作（渲染/剪辑）不碰平台，
 * 用户说几点就几点。
 */
export function validateWindow(input: { kind: 'outbound' | 'internal'; windowMs: number }):
  | { ok: true }
  | { ok: false; reason: string } {
  if (!Number.isFinite(input.windowMs) || input.windowMs < 0) {
    return { ok: false, reason: '窗口结束时间早于开始时间' };
  }
  if (input.kind === 'outbound' && input.windowMs < MIN_OUTBOUND_WINDOW_MS) {
    return {
      ok: false,
      reason: '对外动作至少留 30 分钟窗口——固定整点发送等于向平台自首（铁律 27bb6d1a）',
    };
  }
  return { ok: true };
}

/** as_of 缺失（根本没读到）一律按陈旧处理，页面据此显示"读取失败"而不是"今天没活"。 */
export function isStale(asOf: string | null | undefined, now: number, thresholdMs: number): boolean {
  if (!asOf) return true;
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return true;
  return now - t > thresholdMs;
}

/**
 * 改计划时间的 CAS 语句。
 *
 * `row_version` 判态 + 自增；同时把 `status='queued'` 写进谓词 —— 已经在跑、已完成、
 * 已取消的活不许改时间（改了也没用，只会让页面和现实对不上）。
 * 影响行数为 0 时调用方返回 409 并附当前值，绝不静默后写覆盖。
 */
export function buildCasUpdate(input: { taskId: string; rowVersion: number; dueAt: string }): {
  sql: string;
  params: unknown[];
} {
  const sql = `
    UPDATE tasks
       SET due_at = $3,
           row_version = row_version + 1,
           updated_at = NOW()
     WHERE id = $1
       AND row_version = $2
       AND status = 'queued'
       AND task_type = 'device_job'
    RETURNING id, row_version, due_at`;
  return { sql, params: [input.taskId, input.rowVersion, input.dueAt] };
}

/**
 * 中台 `agents.agent_id` → 工作机上 `adb devices` 看到的裸序列号。
 *
 * 两边对不上就永远派不下去：推帧器注册设备时用的是 `phone-<序列号>`，而领单器跑在
 * 工作机上，手边只有 adb 吐出来的裸序列号。这个字段是派单与真机之间唯一的握手，
 * 存错了页面上会显示排着、却谁也不领（生产实证：单 550326e5 卡在 queued 领不走）。
 *
 * 只剥已知前缀，不认识的形态原样返回 —— 宁可保持原值让人能查，也不猜。
 */
export function toDeviceSerial(agentIdOrSerial: string): string {
  return agentIdOrSerial.replace(/^phone-/, '');
}
