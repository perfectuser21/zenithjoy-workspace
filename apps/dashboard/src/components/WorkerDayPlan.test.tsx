import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WorkerDayPlan, { tally, groupPending } from './WorkerDayPlan';
import type { ScheduleSlot } from '../api/schedule.api';

// fetchSchedule 已接真实后端（本刀）：这里把 fetch 打桩成返回样例排期，
// 让组件仍走真实的取数代码路径，只是数据来自样例。
import { __mockSchedulePayloadForDemo } from '../api/schedule.api';
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: __mockSchedulePayloadForDemo() }),
  })) as unknown as typeof fetch);
});
afterAll(() => { vi.unstubAllGlobals(); });


afterEach(cleanup);

const mk = (status: ScheduleSlot['status'], dept: ScheduleSlot['dept'] = '智能获客', h = 9): ScheduleSlot => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return { id: `${status}-${dept}-${h}`, title: `${dept}-${status}`, dept, planned_at: d.toISOString(), est_minutes: 10, source: 'recurring', status };
};

describe('今日盘点', () => {
  it('分清排了多少、跑完多少、还剩多少、多少件要人管', () => {
    const t = tally([mk('done'), mk('done', '智能获客', 10), mk('queued', '智能获客', 11), mk('failed', '智能获客', 12), mk('blocked', '智能获客', 13), mk('running', '智能获客', 14)]);
    expect(t).toEqual({ planned: 6, done: 2, queued: 1, attention: 2 });
  });

  it('空安排不炸', () => {
    expect(tally([])).toEqual({ planned: 0, done: 0, queued: 0, attention: 0 });
  });

  it('待办按部门分组、组内按时刻升序，已完成的不进待办', () => {
    const g = groupPending([
      mk('queued', '新媒体部', 20),
      mk('done', '智能获客', 8),
      mk('queued', '智能获客', 22),
      mk('blocked', '智能获客', 9),
      mk('running', '智能获客', 10),
    ]);
    expect(g.map((x) => x.dept)).toEqual(['新媒体部', '智能获客'].sort());
    const kj = g.find((x) => x.dept === '智能获客')!;
    expect(kj.items.map((s) => s.status)).toEqual(['blocked', 'queued']); // 9 点的 blocked 排在 22 点的 queued 前
  });
});

describe('WorkerDayPlan 组件', () => {
  const render1 = (id: string) => render(<MemoryRouter><WorkerDayPlan agentId={id} /></MemoryRouter>);

  it('显示今日总量、已完成、待跑、要处理与额度', async () => {
    render1('8e802deb-247d-4346-8028-03c265959431'); // 金诺机，mock 里触达 6/55
    const box = await screen.findByTestId('worker-day-plan');
    // 文本被 <b> 拆开，按整块内容断言更贴近"人眼看到什么"
    // 金诺机每天 3 轮采收 + 20 单触达 = 23 件（样例密度照真机实测的 24 件铺的）
    await waitFor(() => expect(box).toHaveTextContent(/共排\s*23\s*件/));
    expect(box).toHaveTextContent(/已完成\s*\d+/);
    expect(box).toHaveTextContent(/待跑\s*\d+/);
    expect(box).toHaveTextContent(/要处理\s*\d+/);
    expect(box).toHaveTextContent('14/55单');
    expect(box).toHaveTextContent('还能加 41');
  });

  it('列出接下来要跑的（这正是此前页面完全没有的）', async () => {
    render1('8e802deb-247d-4346-8028-03c265959431');
    const box = await screen.findByTestId('worker-day-plan');
    await waitFor(() => expect(within(box).getByText('接下来要跑的')).toBeInTheDocument());
    // 「待跑」的件数与清单必须自洽：还有活就逐条列出来，跑完了就明说跑完了。
    // 不能断言某条具体的活——半夜跑测试时当天的活可能已经全部结束（0921 实测在 23:39 翻车）。
    const pending = Number(box.textContent?.match(/待跑\s*(\d+)/)?.[1] ?? '-1');
    expect(pending).toBeGreaterThanOrEqual(0);
    if (pending > 0) {
      expect(box).toHaveTextContent(/\d{2}:\d{2}/);
      expect(box).not.toHaveTextContent('今天的活都跑完了');
    } else {
      expect(box).toHaveTextContent('今天的活都跑完了');
    }
  });

  it('被挡住的待办带出原因', async () => {
    render1('4c6c15fc-0b2f-479f-a32f-98ca33aaed1d'); // 小龙虾机，mock 里有一条 blocked
    const box = await screen.findByTestId('worker-day-plan');
    await waitFor(() => expect(within(box).getByText('素材待审核')).toBeInTheDocument());
  });

  it('设备不在排程里就整块不渲染，不占版面', async () => {
    const { container } = render1('00000000-0000-4000-8000-000000000000');
    await waitFor(() => expect(container.querySelector('[data-testid="worker-day-plan"]')).toBeNull());
  });
});
