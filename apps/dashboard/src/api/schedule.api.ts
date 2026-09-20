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
}

export interface SchedulePayload {
  /** 数据生成时刻 */
  as_of: string;
  /** true = 后端未就绪，页面展示的是样例数据 */
  mock: boolean;
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
        quotas: [{ dept: '智能获客', used: 6, cap: 55, unit: '单' }],
        slots: [
          slot('k1', '触达 · 私信今日额度', '智能获客', at(0, 8), 14 * 60, 'recurring'),
          slot('k2', '采收 · AI人工智能训练师 6 词', '智能获客', at(0, 22), 90, 'recurring'),
          slot('k3', '采收 · AI人工智能训练师 6 词', '智能获客', at(1, 2), 90, 'recurring'),
          slot('k4', '采收 · AI人工智能训练师 6 词', '智能获客', at(1, 6), 90, 'recurring'),
          slot('k5', '触达 · 私信今日额度', '智能获客', at(1, 8), 14 * 60, 'recurring'),
          slot('k6', '采收 · 转行人工智能 6 词', '智能获客', at(1, 22), 90, 'recurring'),
          slot('k7', '采收 · 转行人工智能 6 词', '智能获客', at(2, 2), 90, 'recurring'),
        ],
      },
      {
        agent_id: '657dfabc-802c-478d-9de3-c05b7db847df',
        name: '悦升工作机',
        serial: 'ANGYVB4402004137',
        online: true,
        depts: ['智能获客', '新媒体部'],
        quotas: [
          { dept: '智能获客', used: 7, cap: 60, unit: '单' },
          { dept: '新媒体部', used: 1, cap: 3, unit: '条' },
        ],
        slots: [
          slot('y1', '触达 · 私信今日额度', '智能获客', at(0, 8), 14 * 60, 'recurring'),
          slot('y2', '发布 ·《AI训练师报考全流程》抖音', '新媒体部', at(0, 20), 12, 'oneoff'),
          slot('y3', '采收 · 西安人工智能训练 6 词', '智能获客', at(0, 22, 30), 90, 'recurring'),
          slot('y4', '发布 ·《学AI要不要转行》小红书', '新媒体部', at(1, 11), 12, 'oneoff'),
          slot('y5', '采收 · 西安人工智能训练 6 词', '智能获客', at(1, 2, 30), 90, 'recurring'),
          slot('y6', '触达 · 私信今日额度', '智能获客', at(1, 8), 14 * 60, 'recurring'),
          slot('y7', '发布 ·《补贴怎么申领》视频号', '新媒体部', at(2, 10), 12, 'oneoff'),
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
          slot('x1', '朋友圈 · 跟圈点赞', '私域客服', at(0, 9), 30, 'recurring'),
          slot('x2', '客服 · 会话轮询接管', '私域客服', at(0, 10), 10 * 60, 'recurring'),
          slot('x3', '朋友圈 · 发布《学员拿证》', '新媒体部', at(0, 19), 10, 'oneoff', {
            status: 'blocked',
            blocked_reason: '素材待审核',
          }),
          slot('x4', '朋友圈 · 跟圈点赞', '私域客服', at(1, 9), 30, 'recurring'),
          slot('x5', '客服 · 会话轮询接管', '私域客服', at(1, 10), 10 * 60, 'recurring'),
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
          slot('b1', '翻拍 · 爆款视频合成', '视频剪辑', at(0, 14), 45, 'recurring', {
            status: 'failed',
          }),
          slot('b2', '翻拍 · 爆款视频合成', '视频剪辑', at(1, 14), 45, 'recurring'),
        ],
      },
    ],
  };
}

/**
 * 拉排程数据。后端就绪后改为：
 *   const r = await fetch(`${API_BASE}/schedule`, { credentials: 'include' });
 *   return (await r.json()).data;
 */
export async function fetchSchedule(): Promise<SchedulePayload> {
  return Promise.resolve(mockPayload());
}

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
