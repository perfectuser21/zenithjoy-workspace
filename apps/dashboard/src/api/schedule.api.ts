/**
 * 设备排程看板的前后端契约（Brain task f9ab4ab5）。
 *
 * ⚠️ 当前 `fetchSchedule` 返回内置 mock：后端还没做。
 * 后端要做的事写在 docs/handoffs/202609201700-f9ab4ab5.md：
 * 周期规则从两台 Mac 的 crontab 搬进 Brain tasks（recurring_task_id），每天展开成当天任务单，
 * Mac 改成领单制，Notion 投影带上设备与部门。后端就绪后把 fetchSchedule 换成真实 GET 即可，
 * 页面与类型都不用动。
 */

/** 部门 = 业务线。与 Notion「OPC 经营对象」的「所属部门」取值对齐 */
export type Dept = '智能获客' | '新媒体部' | '私域客服' | '视频剪辑';

export const DEPTS: Dept[] = ['智能获客', '新媒体部', '私域客服', '视频剪辑'];

export type SlotStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked';

/** 一台设备上的一件活（对应 Brain tasks 一行 → Notion 一条） */
export interface ScheduleSlot {
  id: string;
  title: string;
  dept: Dept;
  /** 计划开始（ISO）。周期规则展开后的具体时刻 */
  planned_at: string;
  /** 预计耗时，分钟。用于时间线排布 */
  est_minutes: number;
  status: SlotStatus;
  /** 来自周期规则（每天 22:00 采收）还是一次性单据（这条内容今晚发） */
  source: 'recurring' | 'oneoff';
  /** 阻塞原因，status=blocked 时有 */
  blocked_reason?: string;
  /** 窗口起止（对外动作排的是窗口不是时刻，铁律 27bb6d1a）；对内动作可为空 */
  window_start?: string | null;
  window_end?: string | null;
  /** 真正执行的时刻——"你排的是窗口，我告诉你实际几点跑的" */
  executed_at?: string | null;
  /** 乐观锁版本号，改时间时原样回传（updated_at 被后台 tick 定时 touch，不能当锁） */
  row_version?: number;
  /** 最后是谁改的，用于条子上显示"你改的 · 12:58" */
  updated_by?: string | null;
}

/** 某台设备在某条业务线上的当日配额 */
export interface DeptQuota {
  dept: Dept;
  /** 今日已用 */
  used: number;
  /** 今日上限（触达来自 dm-daily-cap；采收来自 KPI 闸） */
  cap: number;
  /** 配额单位，展示用：单 / 词 / 条 */
  unit: string;
}

export interface ScheduleDevice {
  /** agents.id（UUID），与控制塔实时页同一把钥匙 */
  agent_id: string;
  /** 展示名，如「金诺工作机」 */
  name: string;
  /** 机身序列号 */
  serial: string;
  online: boolean;
  /** 这台设备服务哪些业务线 */
  depts: Dept[];
  quotas: DeptQuota[];
  /** 未来几天的活，含今天已完成的 */
  slots: ScheduleSlot[];
  /** true = 额度数字还没接通（真身在工作机本地），不要把空数组当成"额度为 0" */
  quotas_stale?: boolean;
}

export interface SchedulePayload {
  /** 数据生成时刻 */
  as_of: string;
  /** true = 后端未就绪，页面展示的是样例数据 */
  mock: boolean;
  /**
   * true = 这份数据没读到 / 已陈旧。**读不到 ≠ 今天没活**：页面必须显示"读取失败"，
   * 绝不能把空排期渲染成"今天没安排"——那会让人以为系统在正常空转。
   */
  stale?: boolean;
  /** stale 的具体原因，直接展示给用户 */
  stale_reason?: string | null;
  devices: ScheduleDevice[];
}

// ─────────────────────────── mock ───────────────────────────

const HOUR = 3600_000;

function at(dayOffset: number, hh: number, mm = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** 按当前时刻推断状态：过去=done，正在进行=running，未来=queued */
function autoStatus(iso: string, minutes: number): SlotStatus {
  const start = new Date(iso).getTime();
  const now = Date.now();
  if (now < start) return 'queued';
  if (now < start + minutes * 60_000) return 'running';
  return 'done';
}

function slot(
  id: string,
  title: string,
  dept: Dept,
  planned_at: string,
  est_minutes: number,
  source: ScheduleSlot['source'],
  override?: Partial<ScheduleSlot>,
): ScheduleSlot {
  return { id, title, dept, planned_at, est_minutes, source, status: autoStatus(planned_at, est_minutes), ...override };
}

/** 周期规则：每天同一时刻重复的活（采收三轮、触达额度、朋友圈、客服值守…） */
interface Recur {
  hh: number;
  mm?: number;
  minutes: number;
  dept: Dept;
  /** 标题可按天轮换（如采收每天换词） */
  title: string | ((day: number) => string);
}

/** 把周期规则展开成 days 天的具体任务 */
function expand(prefix: string, rules: Recur[], days: number): ScheduleSlot[] {
  const out: ScheduleSlot[] = [];
  for (let d = 0; d < days; d++) {
    rules.forEach((r, i) => {
      const title = typeof r.title === 'function' ? r.title(d) : r.title;
      out.push(slot(`${prefix}-${d}-${i}`, title, r.dept, at(d, r.hh, r.mm ?? 0), r.minutes, 'recurring'));
    });
  }
  return out;
}

const HARVEST_WORDS = ['AI人工智能训练师', '转行人工智能', '西安 人工智能训练', '裁员后学什么', '人工智能训练师怎么考', 'AI就业', '学AI'];
const word = (base: number) => (d: number) => `采收 · ${HARVEST_WORDS[(base + d) % HARVEST_WORDS.length]} 6 词`;

/**
 * 触达单的昵称池。真机 history 里就长这样：触达·单#103 嶒崚 / 触达·单#99 miki。
 * 压成一条「今日额度」会把一天二十几单缩成一行——主理人一眼就看出来活变少了。
 */
const NICKNAMES = [
  '嶒崚', 'miki', '叫我二姐姐', 'Lydiii', '骆驼。', '樱树花', '梦醒记', 'Merry',
  '-色拉油', 'walan周', '不吃香菜的猹', '甜甜菜菜', '海哥', '小满', '阿远', '柚子茶',
  '晚风', '南山', '一只鹿', '陈同学', '老周', '小鹿乱撞', '芝士就是力量', '打工人小李',
];

/**
 * 把一天的触达按真机节奏展开成一单一行。
 *
 * 全部确定式（按索引推间隔与时长，不用随机数）：页面每 5 秒轮询一次，用随机数会让
 * 活每次刷新都换一批；测试里「两次拉取结果一致」也会时好时坏。
 *
 * @param prefix  id 前缀，保证跨设备不撞
 * @param day     相对今天第几天
 * @param startHh 从几点开始跑
 * @param count   这天跑多少单
 * @param seed    同一天不同设备错开节奏用
 */
function outreachRuns(prefix: string, day: number, startHh: number, count: number, seed: number): ScheduleSlot[] {
  const out: ScheduleSlot[] = [];
  let cursor = new Date(at(day, startHh)).getTime();
  for (let i = 0; i < count; i++) {
    const k = i + seed * 7 + day * 3;
    // 1–13 分钟，多数在 2–5 分钟，偶尔卡一单十几分钟（真机上是等对方页面加载）
    const minutes = k % 11 === 0 ? 12 + (k % 3) : 1 + (k % 5);
    const no = 20 + day * 60 + i * 2 + seed;
    const nick = NICKNAMES[(i + seed * 5 + day) % NICKNAMES.length];
    // 每 9 单里坏 1 单：真机今天 24 单里有 4 单失败
    const bad = k % 9 === 4;
    out.push(
      slot(`${prefix}-o-${day}-${i}`, `触达 · 单#${no} ${nick}`, '智能获客', new Date(cursor).toISOString(), minutes, 'recurring',
        bad ? { status: 'failed' } : undefined),
    );
    // 单与单之间隔 6–34 分钟
    cursor += (minutes + 6 + ((k * 13) % 29)) * 60_000;
  }
  return out;
}

/** 把多天的触达串起来 */
function outreachDays(prefix: string, startHh: number, count: number, seed: number, days: number): ScheduleSlot[] {
  return Array.from({ length: days }, (_, d) => outreachRuns(prefix, d, startHh, count, seed)).flat();
}

const DAYS_AHEAD = 7;

function mockPayload(): SchedulePayload {
  return {
    as_of: new Date().toISOString(),
    mock: true,
    devices: [
      {
        agent_id: '8e802deb-247d-4346-8028-03c265959431',
        name: '金诺工作机',
        serial: 'ANGYVB4227006983',
        online: true,
        depts: ['智能获客'],
        quotas: [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }],
        slots: expand(
          'k',
          [
            { hh: 2, minutes: 90, dept: '智能获客', title: word(0) },
            { hh: 6, minutes: 90, dept: '智能获客', title: word(0) },
            { hh: 22, minutes: 90, dept: '智能获客', title: word(1) },
          ],
          DAYS_AHEAD,
        ).concat(outreachDays('k', 8, 20, 0, DAYS_AHEAD)),
      },
      {
        agent_id: '657dfabc-802c-478d-9de3-c05b7db847df',
        name: '悦升工作机',
        serial: 'ANGYVB4402004137',
        online: true,
        depts: ['智能获客', '新媒体部'],
        quotas: [
          { dept: '智能获客', used: 15, cap: 60, unit: '单' },
          { dept: '新媒体部', used: 1, cap: 3, unit: '条' },
        ],
        slots: [
          ...expand(
            'y',
            [
              { hh: 2, mm: 30, minutes: 90, dept: '智能获客', title: word(2) },
              { hh: 22, mm: 30, minutes: 90, dept: '智能获客', title: word(2) },
            ],
            DAYS_AHEAD,
          ),
          ...outreachDays('y', 9, 17, 1, DAYS_AHEAD),
          slot('y-pub-1', '发布 ·《AI训练师报考全流程》抖音', '新媒体部', at(0, 20), 12, 'oneoff'),
          slot('y-pub-2', '发布 ·《学AI要不要转行》小红书', '新媒体部', at(1, 11), 12, 'oneoff'),
          slot('y-pub-3', '发布 ·《补贴怎么申领》视频号', '新媒体部', at(2, 10), 12, 'oneoff'),
          slot('y-pub-4', '发布 ·《学员就业回访》抖音', '新媒体部', at(4, 20), 12, 'oneoff'),
        ],
      },
      {
        agent_id: '4c6c15fc-0b2f-479f-a32f-98ca33aaed1d',
        name: '小龙虾机',
        serial: 'ANGYVB4311010223',
        online: true,
        depts: ['私域客服', '新媒体部'],
        quotas: [
          { dept: '私域客服', used: 12, cap: 40, unit: '条' },
          { dept: '新媒体部', used: 0, cap: 3, unit: '条' },
        ],
        slots: [
          ...expand(
            'x',
            [
              { hh: 9, minutes: 30, dept: '私域客服', title: '朋友圈 · 跟圈点赞' },
              { hh: 10, minutes: 10 * 60, dept: '私域客服', title: '客服 · 会话轮询接管' },
            ],
            DAYS_AHEAD,
          ),
          slot('x-mom-1', '朋友圈 · 发布《学员拿证》', '新媒体部', at(0, 19), 10, 'oneoff', {
            status: 'blocked',
            blocked_reason: '素材待审核',
          }),
          slot('x-mom-2', '朋友圈 · 发布《开班通知》', '新媒体部', at(3, 19), 10, 'oneoff'),
        ],
      },
      {
        agent_id: '2c5b94b2-d411-429f-a295-153c5ad28160',
        name: '小白机',
        serial: 'e6c7ef34',
        online: true,
        depts: ['视频剪辑'],
        quotas: [{ dept: '视频剪辑', used: 0, cap: 2, unit: '条' }],
        slots: [
          ...expand('b', [{ hh: 14, minutes: 45, dept: '视频剪辑', title: '翻拍 · 爆款视频合成' }], DAYS_AHEAD).filter((x) => !x.id.startsWith('b-0-')),
          slot('b-fail', '翻拍 · 爆款视频合成', '视频剪辑', at(0, 14), 45, 'recurring', { status: 'failed' }),
        ],
      },
    ],
  };
}

// 用可选链读 import.meta.env：Playwright 的测试进程在 node 下 import 本模块
// （为了拿 __mockSchedulePayloadForDemo 当 E2E 桩数据），那里没有 import.meta.env。
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || '/api';

/** 读不到时给出的空壳：devices 为空 + stale=true，页面据此显示"读取失败"而不是"今天没活" */
function unreachablePayload(reason: string): SchedulePayload {
  return { as_of: new Date().toISOString(), mock: false, stale: true, stale_reason: reason, devices: [] };
}

/**
 * 拉排程数据。
 *
 * 失败**不抛异常**，而是返回 stale 的空壳 —— 调用方过去是裸 `.then()` 没有 catch，
 * 一抛就变成 devices=[] 渲染成"今天没活"，把"后台断了"伪装成"今天没安排"。
 * 这里把失败变成一个页面能看见、能说人话的状态。
 */
export async function fetchSchedule(): Promise<SchedulePayload> {
  try {
    const r = await fetch(`${API_BASE}/schedule`, { credentials: 'include' });
    if (!r.ok) return unreachablePayload(`读取排程失败（HTTP ${r.status}）`);
    const body = await r.json();
    const data = body?.data;
    if (!data || !Array.isArray(data.devices)) return unreachablePayload('排程接口返回了预期外的内容');
    return data as SchedulePayload;
  } catch (e) {
    return unreachablePayload(`连不上排程后台：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 样例数据保留给 Storybook / 本地演示，不再进生产路径 */
export { mockPayload as __mockSchedulePayloadForDemo };

// ─────────────────────── 看板用的派生计算 ───────────────────────

/** 一天的起止（本地时区） */
export function dayRange(dayOffset: number): { start: number; end: number } {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(0, 0, 0, 0);
  return { start: d.getTime(), end: d.getTime() + 24 * HOUR };
}

export function slotsOfDay(slots: ScheduleSlot[], dayOffset: number): ScheduleSlot[] {
  const { start, end } = dayRange(dayOffset);
  return slots
    .filter((s) => {
      const t = new Date(s.planned_at).getTime();
      return t >= start && t < end;
    })
    .sort((a, b) => a.planned_at.localeCompare(b.planned_at));
}

/** 积压 = 还没跑的（排队中 + 被挡住的） */
export function backlogCount(slots: ScheduleSlot[]): number {
  return slots.filter((s) => s.status === 'queued' || s.status === 'blocked').length;
}

/** 还能加多少量：所有业务线配额的剩余合计 */
export function headroom(quotas: DeptQuota[]): number {
  return quotas.reduce((n, q) => n + Math.max(0, q.cap - q.used), 0);
}

// ─────────────────────── 派单 / 改时间 / 取消 ───────────────────────

/** 一件活的动作参数：交给工作机上的领单器执行 */
export interface JobParams {
  /** douyin-phone-adb 的子命令，如 open-search / open-app / screencap */
  action: string;
  /** 设备 profile（如 legacy / jinoshengyuan-work）；缺省时领单器用机身序列号兜底 */
  profile?: string;
  /** 动作的参数，如搜索关键词 */
  arg?: string;
}

export interface DispatchInput {
  agent_id: string;
  dept: Dept;
  title: string;
  /** 排的是窗口不是时刻：对外动作不得窄于 30 分钟（铁律 27bb6d1a），系统在窗口内随机落点 */
  window_start: string;
  window_end: string;
  est_minutes?: number;
  params?: JobParams;
}

/** 把后端给的人话原因抛出来，不要吞成一句"失败" —— 用户得知道是窗口太窄还是额度不够 */
async function postJson<T>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.success === false) {
    const err = new Error(j?.message || j?.error || `请求失败（HTTP ${r.status}）`) as Error & { current?: unknown };
    if (j?.current) err.current = j.current;
    throw err;
  }
  return j.data as T;
}

/**
 * 派一件活。
 *
 * 幂等键由客户端生成：跨境写请求 8 秒超时后的重试不能派出第二批
 * （wall-report 踩过这个坑，PR#1892）。
 */
export function dispatchJob(input: DispatchInput): Promise<{ id: string; planned_at?: string; deduped?: boolean }> {
  const idempotency_key =
    globalThis.crypto?.randomUUID?.() ?? `dj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return postJson(`${API_BASE}/schedule/jobs`, { ...input, idempotency_key });
}

/** 改计划时间。必须回传读到的 row_version 做 CAS —— 冲突时后端返 409 并附当前值。 */
export function updateJobTime(id: string, planned_at: string, row_version: number) {
  return postJson<{ id: string; row_version: number; planned_at: string }>(
    `${API_BASE}/schedule/jobs/${encodeURIComponent(id)}/time`,
    { planned_at, row_version },
    'PATCH',
  );
}

/** 取消（后端标记留痕，不删行） */
export function cancelJob(id: string) {
  return postJson<{ id: string }>(`${API_BASE}/schedule/jobs/${encodeURIComponent(id)}/cancel`, {});
}
