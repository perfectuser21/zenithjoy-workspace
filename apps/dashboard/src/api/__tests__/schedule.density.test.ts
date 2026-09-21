/**
 * 样例排期的密度必须对得上真机一天的真实工作量（Brain task 187f78ce）
 *
 * 主理人：「我记着原来有那么多工作呢呀，你现在咋一弄就变得很少了？那一天不是好多个吗？」
 * 实测 staging：金诺机今天真实执行 24 件、悦升 20 件，而样例把一整天触达压成
 * 一条 08:00–22:00，表里只剩 4 行——既对不上他的记忆，也撑不满固定高度的表格，
 * 他要的那个上下滑杆根本不出现。
 */
import { describe, it, expect } from 'vitest';
import { __mockSchedulePayloadForDemo, slotsOfDay, DEPTS, type ScheduleSlot } from '../schedule.api';

// fetchSchedule 已接真实后端；样例密度这件事从此直接对样例本身断言
const load = async () => __mockSchedulePayloadForDemo().devices;

/** 一天里排得最满的那台机 */
const busiest = (devs: Awaited<ReturnType<typeof load>>, dayOffset: number) =>
  devs.map((d) => slotsOfDay(d.slots, dayOffset)).sort((a, b) => b.length - a.length)[0];

describe('样例排期的密度', () => {
  it('最忙的机子一天排够二十件以上，对得上真机实际跑的量', async () => {
    const devs = await load();
    expect(busiest(devs, 0).length).toBeGreaterThanOrEqual(20);
  });

  it('触达是一单一行，不是压成一条「今日额度」', async () => {
    const devs = await load();
    const all = devs.flatMap((d) => slotsOfDay(d.slots, 0));
    const 触达 = all.filter((s) => s.title.startsWith('触达'));
    expect(触达.length).toBeGreaterThanOrEqual(12);
    // 每单都带单号和昵称，跟真机 history 的写法一致
    for (const s of 触达) expect(s.title).toMatch(/^触达 · 单#\d+ .+/);
    // 没有那条把一整天压成一行的额度任务
    expect(all.some((s) => s.title.includes('今日额度'))).toBe(false);
  });

  it('触达单耗时像真的：都在 1 到 15 分钟之间', async () => {
    const devs = await load();
    const 触达 = devs.flatMap((d) => slotsOfDay(d.slots, 0)).filter((s) => s.title.startsWith('触达'));
    for (const s of 触达) {
      expect(s.est_minutes).toBeGreaterThanOrEqual(1);
      expect(s.est_minutes).toBeLessThanOrEqual(15);
    }
  });

  it('一天里有失败的单，不是清一色成功', async () => {
    const devs = await load();
    const all = devs.flatMap((d) => slotsOfDay(d.slots, 0));
    expect(all.filter((s) => s.status === 'failed').length).toBeGreaterThan(0);
  });

  it('后面几天也排满，不是只有今天有数据', async () => {
    const devs = await load();
    for (const off of [1, 2, 3]) {
      expect(busiest(devs, off).length).toBeGreaterThanOrEqual(15);
    }
  });

  it('同一台机的单子不撞车：触达之间不重叠', async () => {
    const devs = await load();
    for (const d of devs) {
      const 触达 = slotsOfDay(d.slots, 0)
        .filter((s) => s.title.startsWith('触达'))
        .sort((a, b) => new Date(a.planned_at).getTime() - new Date(b.planned_at).getTime());
      for (let i = 1; i < 触达.length; i++) {
        const prevEnd = new Date(触达[i - 1].planned_at).getTime() + 触达[i - 1].est_minutes * 60_000;
        expect(new Date(触达[i].planned_at).getTime()).toBeGreaterThanOrEqual(prevEnd);
      }
    }
  });

  it('每件活的 id 唯一，不然表格 key 会撞', async () => {
    const devs = await load();
    const ids = devs.flatMap((d) => d.slots).map((s: ScheduleSlot) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('部门取值都在约定清单里', async () => {
    const devs = await load();
    for (const s of devs.flatMap((d) => d.slots)) expect(DEPTS).toContain(s.dept);
  });

  it('两次拉取给出同样的排期，不是每次随机一份', async () => {
    const a = __mockSchedulePayloadForDemo().devices.flatMap((d) => d.slots).map((s) => `${s.id}|${s.title}|${s.est_minutes}`);
    const b = __mockSchedulePayloadForDemo().devices.flatMap((d) => d.slots).map((s) => `${s.id}|${s.title}|${s.est_minutes}`);
    expect(a).toEqual(b);
  });
});
