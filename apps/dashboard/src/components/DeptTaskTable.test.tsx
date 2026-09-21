import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DeptTaskTable, { groupByDept, parallelWith, durationText } from './DeptTaskTable';
import { dayRange, type ScheduleSlot } from '../api/schedule.api';

afterEach(cleanup);

const HOUR = 3600_000;
const at = (hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: `s-${hh}-${minutes}-${extra.id ?? ''}`,
  title: `${hh} 点的活`,
  dept: '智能获客',
  planned_at: new Date(dayRange(0).start + hh * HOUR).toISOString(),
  est_minutes: minutes,
  source: 'recurring',
  status: 'queued',
  ...extra,
});

/** 指定第几天的活。空档相关的用例都排在明天，整天都是未来，能塞几单才不跟着时钟漂 */
const atDay = (day: number, hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  ...at(hh, minutes, extra),
  planned_at: new Date(dayRange(day).start + hh * HOUR).toISOString(),
});

describe('按部门分组', () => {
  it('同部门的活归一组，组内按开始时刻从早到晚', () => {
    const groups = groupByDept(
      [
        at(22, 60, { id: 'a', title: '晚的获客' }),
        at(9, 60, { id: 'b', title: '早的获客' }),
        at(20, 12, { id: 'c', title: '发布', dept: '新媒体部' }),
      ],
      0,
    );
    expect(groups.map((g) => g.dept)).toEqual(['智能获客', '新媒体部']);
    expect(groups[0].items.map((s) => s.title)).toEqual(['早的获客', '晚的获客']);
    expect(groups[1].items).toHaveLength(1);
  });

  it('部门顺序照约定的部门清单排，不按字母也不按随机', () => {
    const groups = groupByDept(
      [at(9, 60, { id: 'a', dept: '视频剪辑' }), at(10, 60, { id: 'b', dept: '智能获客' })],
      0,
    );
    expect(groups.map((g) => g.dept)).toEqual(['智能获客', '视频剪辑']);
  });

  it('没活的部门不出现，不留空分组', () => {
    const groups = groupByDept([at(9, 60)], 0);
    expect(groups).toHaveLength(1);
  });

  it('只取指定那天，别的天不混进来', () => {
    const tomorrow: ScheduleSlot = {
      ...at(8, 60),
      id: 'tmr',
      title: '明天的活',
      planned_at: new Date(dayRange(1).start + 8 * HOUR).toISOString(),
    };
    const groups = groupByDept([at(8, 60, { id: 'today', title: '今天的活' }), tomorrow], 0);
    expect(groups[0].items.map((s) => s.title)).toEqual(['今天的活']);
  });

  it('每组带上这组的件数与已完成数', () => {
    const groups = groupByDept([at(2, 60, { id: 'a', status: 'done' }), at(9, 60, { id: 'b' })], 0);
    expect(groups[0].total).toBe(2);
    expect(groups[0].done).toBe(1);
  });
});

describe('并行判定与时长写法', () => {
  it('时间区间有重叠就算并行，贴着结束不算', () => {
    const 触达 = at(8, 14 * 60, { id: 'a' });
    const 采收 = at(22, 90, { id: 'b' });
    const 客服 = at(10, 600, { id: 'c' });
    const all = [触达, 采收, 客服];
    expect(parallelWith(触达, all).map((s) => s.id)).toEqual(['c']);
    expect(parallelWith(采收, all)).toEqual([]);
  });

  it('跨部门的活也算并行，分组不影响重叠判定', () => {
    const 触达 = at(8, 14 * 60, { id: 'a' });
    const 发布 = at(20, 12, { id: 'b', dept: '新媒体部' });
    expect(parallelWith(触达, [触达, 发布]).map((s) => s.id)).toEqual(['b']);
  });

  it('时长写成人话', () => {
    expect(durationText(45)).toBe('45 分钟');
    expect(durationText(60)).toBe('1 小时');
    expect(durationText(90)).toBe('1 小时 30 分');
  });
});

describe('表格', () => {
  const renderTable = (slots: ScheduleSlot[], props: Partial<React.ComponentProps<typeof DeptTaskTable>> = {}) =>
    render(<DeptTaskTable slots={slots} dayOffset={0} {...props} />);

  it('滚动容器高度钉死且自己滚，页面不会被撑长', () => {
    renderTable([at(8, 60)]);
    const box = screen.getByTestId('table-scroll');
    expect(box.className).toMatch(/overflow-y-auto/);
    expect(box.className).toMatch(/h-\[\d+px\]/);
  });

  it('每个部门一个分组表头，表头写出部门和件数', () => {
    renderTable([at(9, 60, { id: 'a' }), at(20, 12, { id: 'b', dept: '新媒体部' })]);
    const heads = screen.getAllByTestId('dept-head');
    expect(heads).toHaveLength(2);
    expect(heads[0]).toHaveTextContent('智能获客');
    expect(heads[0]).toHaveTextContent(/1\s*件/);
  });

  it('每件活一行，时间列给出起止与时长', () => {
    renderTable([at(8, 90)]);
    const row = screen.getByTestId('task-row');
    expect(row).toHaveTextContent('08:00–09:30');
    expect(row).toHaveTextContent('1 小时 30 分');
  });

  it('列头是时间、任务、状态、说明，且滚动时钉在顶上', () => {
    renderTable([at(8, 60)]);
    const head = screen.getByTestId('col-head');
    for (const h of ['时间', '任务', '状态', '说明']) expect(head).toHaveTextContent(h);
    expect(head.className).toMatch(/sticky/);
  });

  it('并行的活标出来，并说明跟谁同时在跑', () => {
    renderTable([at(8, 14 * 60, { id: 'a', title: '触达 · 私信今日额度' }), at(10, 600, { id: 'c', title: '客服 · 会话轮询' })]);
    expect(screen.getAllByTestId('parallel-badge')).toHaveLength(2);
    expect(screen.getAllByText(/同时在跑：/).length).toBeGreaterThan(0);
  });

  it('不重叠的活不标并行', () => {
    renderTable([at(2, 90, { id: 'a' }), at(6, 90, { id: 'b' })]);
    expect(screen.queryAllByTestId('parallel-badge')).toHaveLength(0);
  });

  it('失败的活说人话而不是机器码', () => {
    renderTable([at(14, 45, { status: 'failed' })]);
    const row = screen.getByTestId('task-row');
    expect(row).toHaveTextContent('机器失联');
    expect(row.textContent).not.toMatch(/executor_lost/);
  });

  it('被挡住的活写出原因', () => {
    renderTable([at(19, 10, { status: 'blocked', blocked_reason: '素材待审核' })]);
    expect(screen.getByTestId('task-row')).toHaveTextContent('素材待审核');
  });

  it('已完成的活压暗，跟还没跑的分得出来', () => {
    // 不划删除线：一屏二十多行里划掉一大片，读起来像全都作废了（0921 主理人说「不好看」后改）
    renderTable([at(8, 60, { id: 'd', status: 'done', title: '做完的活' }), at(9, 60, { id: 'q', title: '没跑的活' })]);
    const done = screen.getByText('做完的活').className;
    const queued = screen.getByText('没跑的活').className;
    expect(done).not.toMatch(/line-through/);
    expect(done).not.toBe(queued);
    expect(done).toMatch(/text-neutral-400/);
  });

  it('跨天的活写出次日结束时刻', () => {
    renderTable([at(23, 90)]);
    expect(screen.getByTestId('task-row')).toHaveTextContent('次日 00:30');
  });

  it('头上给出当天件数、已完成、待跑与额度', () => {
    renderTable([at(2, 60, { id: 'a', status: 'done' }), at(9, 60, { id: 'b' })], {
      quotas: [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }],
    });
    const head = screen.getByTestId('table-head');
    expect(head).toHaveTextContent(/共\s*2\s*件/);
    expect(head).toHaveTextContent(/已完成\s*1/);
    expect(head).toHaveTextContent(/待跑\s*1/);
    expect(head).toHaveTextContent('14/55单');
  });

  it('活与活之间的空档单独成行，写出空多久、还能塞几单', () => {
    renderTable([atDay(1, 8, 60, { id: 'a' }), atDay(1, 20, 60, { id: 'b' })], { dayOffset: 1 });
    const gaps = screen.getAllByTestId('gap-row');
    expect(gaps.length).toBeGreaterThan(0);
    const mid = gaps.find((g) => g.textContent?.includes('09:00'))!;
    expect(mid).toBeDefined();
    expect(mid).toHaveTextContent('11 小时');
    expect(mid.textContent).toMatch(/还能插\s*\d+\s*单/);
  });

  it('空档行跟任务行分得开，不会被当成一件活', () => {
    renderTable([atDay(1, 8, 60, { id: 'a' }), atDay(1, 20, 60, { id: 'b' })], { dayOffset: 1 });
    expect(screen.getAllByTestId('task-row')).toHaveLength(2);
    expect(screen.getAllByTestId('gap-row').length).toBeGreaterThan(0);
  });

  it('表头直接回答还能加多少，以及被什么卡住', () => {
    renderTable([atDay(1, 8, 60, { id: 'a' })], {
      dayOffset: 1,
      quotas: [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }],
    });
    const head = screen.getByTestId('table-head');
    expect(head.textContent).toMatch(/还能加\s*\d+\s*单/);
    expect(head.textContent).toMatch(/空档/);
  });

  it('排满的一天明说没有空档了', () => {
    const full = Array.from({ length: 24 }, (_, h) => atDay(1, h, 60, { id: `h${h}` }));
    renderTable(full, { dayOffset: 1 });
    expect(screen.queryAllByTestId('gap-row')).toHaveLength(0);
    expect(screen.getByTestId('table-head')).toHaveTextContent('排满了');
  });

  it('说明列不再写死宽度，空着的时候把地方让给任务名', () => {
    renderTable([at(8, 60)]);
    const head = screen.getByTestId('col-head');
    const cols = head.querySelectorAll('th');
    const last = cols[cols.length - 1];
    expect(last).toHaveTextContent('说明');
    expect(last.className).not.toMatch(/w-\[\d+%\]/);
  });

  it('划过某一行会告诉外面那件活是几点的，用来联动条子', () => {
    const onHover = vi.fn();
    renderTable([at(8, 60)], { onHoverAt: onHover });
    fireEvent.mouseEnter(screen.getByTestId('task-row'));
    expect(typeof onHover.mock.calls[0][0]).toBe('number');
    fireEvent.mouseLeave(screen.getByTestId('task-row'));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('外面告诉它划到了哪个时刻，对应那一行亮起来', () => {
    const start = dayRange(0).start + 8 * HOUR;
    renderTable([at(8, 60, { id: 'hit' }), at(20, 60, { id: 'miss' })], { highlightAt: start + 5 * 60_000 });
    const rows = screen.getAllByTestId('task-row');
    expect(rows[0].getAttribute('data-hot')).toBe('1');
    expect(rows[1].getAttribute('data-hot')).toBe('0');
  });

  it('没排程与这天没安排给不同提示', () => {
    const { unmount } = renderTable([], { noSchedule: true });
    expect(screen.getByText('这台机还没有排程')).toBeInTheDocument();
    unmount();
    renderTable([]);
    expect(screen.getByText('这天没有安排')).toBeInTheDocument();
  });
});
