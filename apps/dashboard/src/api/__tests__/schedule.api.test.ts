import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __mockSchedulePayloadForDemo,
  fetchSchedule,
  slotsOfDay,
  backlogCount,
  headroom,
  dayRange,
  DEPTS,
  type ScheduleSlot,
} from '../schedule.api';

/** 构造一条活；状态显式给，不依赖"现在几点"（CI 跑 UTC，靠时刻推断会翻车） */
const mk = (status: ScheduleSlot['status'], planned_at = new Date().toISOString()): ScheduleSlot => ({
  id: `s-${status}-${planned_at}`,
  title: 't',
  dept: '智能获客',
  planned_at,
  est_minutes: 10,
  source: 'recurring',
  status,
});

describe('派生计算', () => {
  it('积压只算待跑与被挡住的，不算已完成/进行中/失败', () => {
    expect(backlogCount([mk('queued'), mk('blocked'), mk('done'), mk('running'), mk('failed')])).toBe(2);
    expect(backlogCount([mk('done'), mk('running')])).toBe(0);
    expect(backlogCount([])).toBe(0);
  });

  it('可加量是各业务线剩余之和，用超了按 0 算不倒扣', () => {
    expect(
      headroom([
        { dept: '智能获客', used: 6, cap: 55, unit: '单' },
        { dept: '新媒体部', used: 1, cap: 3, unit: '条' },
      ]),
    ).toBe(51);
    expect(headroom([{ dept: '智能获客', used: 70, cap: 55, unit: '单' }])).toBe(0);
    expect(headroom([])).toBe(0);
  });

  it('按天切片只取当天，跨天的不混进来，且按时刻升序', () => {
    const { start } = dayRange(0);
    const today9 = new Date(start + 9 * 3600_000).toISOString();
    const today20 = new Date(start + 20 * 3600_000).toISOString();
    const tomorrow2 = new Date(start + 26 * 3600_000).toISOString();
    const yesterday = new Date(start - 3600_000).toISOString();
    const all = [mk('queued', today20), mk('queued', tomorrow2), mk('done', today9), mk('done', yesterday)];

    const today = slotsOfDay(all, 0);
    expect(today.map((s) => s.planned_at)).toEqual([today9, today20]);
    expect(slotsOfDay(all, 1).map((s) => s.planned_at)).toEqual([tomorrow2]);
    expect(slotsOfDay(all, 2)).toEqual([]);
  });

  it('dayRange 是本地零点起算的 24 小时', () => {
    const { start, end } = dayRange(0);
    expect(new Date(start).getHours()).toBe(0);
    expect(end - start).toBe(24 * 3600_000);
    expect(dayRange(1).start - start).toBe(24 * 3600_000);
  });
});

describe('样例数据（演示/测试用，不再进生产路径）', () => {
  it('显式标注 mock，避免被当成真实数据', async () => {
    expect(__mockSchedulePayloadForDemo().mock).toBe(true);
  });

  it('每台设备的业务线、额度、活三者对得上', async () => {
    const { devices } = __mockSchedulePayloadForDemo();
    expect(devices.length).toBeGreaterThan(0);
    for (const d of devices) {
      expect(d.agent_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(d.depts.length).toBeGreaterThan(0);
      // 每条业务线都要有额度，否则页面答不了"还能加多少量"
      expect(d.quotas.map((q) => q.dept).sort()).toEqual([...d.depts].sort());
      // 活只能落在这台设备负责的业务线上
      for (const s of d.slots) expect(d.depts).toContain(s.dept);
      for (const q of d.quotas) expect(q.cap).toBeGreaterThan(0);
    }
  });

  it('部门取值都在约定清单内（与 Notion OPC 经营对象的所属部门对齐）', async () => {
    const { devices } = __mockSchedulePayloadForDemo();
    for (const d of devices) {
      for (const x of d.depts) expect(DEPTS).toContain(x);
      for (const s of d.slots) expect(DEPTS).toContain(s.dept);
    }
  });

  it('被挡住的活必须给出原因，否则页面只能显示干巴巴的"被挡住"', async () => {
    const { devices } = __mockSchedulePayloadForDemo();
    const blocked = devices.flatMap((d) => d.slots).filter((s) => s.status === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);
    for (const s of blocked) expect(s.blocked_reason).toBeTruthy();
  });
});

describe('fetchSchedule 的降级：读不到不能装成"今天没活"', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('HTTP 非 2xx → stale=true 带原因，而不是抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch);
    const p = await fetchSchedule();
    expect(p.stale).toBe(true);
    expect(p.stale_reason).toContain('502');
    expect(p.devices).toEqual([]);
    expect(p.mock).toBe(false);
  });

  it('网络直接抛错 → 同样 stale=true，调用方不需要 catch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    const p = await fetchSchedule();
    expect(p.stale).toBe(true);
    expect(p.stale_reason).toContain('ECONNREFUSED');
  });

  it('返回体形状不对（没有 devices 数组）→ 按读不到处理，不让页面崩在 .map 上', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) })) as unknown as typeof fetch);
    const p = await fetchSchedule();
    expect(p.stale).toBe(true);
    expect(p.devices).toEqual([]);
  });

  it('正常返回时原样透出后端数据', async () => {
    const payload = { as_of: '2026-09-21T07:00:00.000Z', mock: false, stale: false, devices: [] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: payload }) })) as unknown as typeof fetch);
    expect(await fetchSchedule()).toEqual(payload);
  });
});
