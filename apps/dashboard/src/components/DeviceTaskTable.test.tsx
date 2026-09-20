import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DeviceTaskTable, { span, parallelWith, durationText } from './DeviceTaskTable';
import { dayRange, type ScheduleSlot } from '../api/schedule.api';

afterEach(cleanup);

const HOUR = 3600_000;
const at = (hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: `s-${hh}-${minutes}-${extra.status ?? 'q'}`,
  title: `${hh} 点的活`,
  dept: '智能获客',
  planned_at: new Date(dayRange(0).start + hh * HOUR).toISOString(),
  est_minutes: minutes,
  source: 'recurring',
  status: 'queued',
  ...extra,
});

const renderTable = (slots: ScheduleSlot[], props: Partial<React.ComponentProps<typeof DeviceTaskTable>> = {}) =>
  render(
    <MemoryRouter>
      <DeviceTaskTable name="金诺工作机" serial="SER1" online href="/dashboard/workers/x" slots={slots} dayOffset={0} {...props} />
    </MemoryRouter>,
  );

describe('并行判定', () => {
  it('时间区间有重叠就算并行', () => {
    const 触达 = at(8, 14 * 60, { id: 'a', title: '触达·私信今日额度' }); // 08:00–22:00
    const 采收 = at(22, 90, { id: 'b', title: '采收·转行人工智能' }); // 22:00–23:30，贴着结束不算重叠
    const 客服 = at(10, 600, { id: 'c', title: '客服·会话轮询' }); // 10:00–20:00，落在触达里
    const all = [触达, 采收, 客服];
    expect(parallelWith(触达, all).map((s) => s.id)).toEqual(['c']);
    expect(parallelWith(采收, all)).toEqual([]);
    expect(parallelWith(客服, all).map((s) => s.id)).toEqual(['a']);
  });

  it('自己不算和自己并行', () => {
    const s = at(8, 60);
    expect(parallelWith(s, [s])).toEqual([]);
  });

  it('起止时间按时长算出来', () => {
    const s = at(8, 90);
    const { start, end } = span(s);
    expect(end - start).toBe(90 * 60_000);
  });
});

describe('时长写法', () => {
  it('不足一小时写分钟，整小时不带零头', () => {
    expect(durationText(45)).toBe('45 分钟');
    expect(durationText(60)).toBe('1 小时');
    expect(durationText(90)).toBe('1 小时 30 分');
    expect(durationText(14 * 60)).toBe('14 小时');
  });
});

describe('任务表', () => {
  it('一台机一张表，每件活一行，按开始时间排', () => {
    renderTable([at(22, 90, { title: '晚上的活' }), at(8, 60, { title: '早上的活' })]);
    const rows = screen.getAllByTestId('task-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('早上的活');
    expect(rows[1]).toHaveTextContent('晚上的活');
  });

  it('时间列给出起止与时长', () => {
    renderTable([at(8, 90)]);
    const row = screen.getByTestId('task-row');
    expect(row).toHaveTextContent('08:00–09:30');
    expect(row).toHaveTextContent('1 小时 30 分');
  });

  it('并行的活标出来，并说明跟谁同时在跑', () => {
    renderTable([
      at(8, 14 * 60, { id: 'a', title: '触达·私信今日额度' }),
      at(10, 600, { id: 'c', title: '客服·会话轮询' }),
    ]);
    const badges = screen.getAllByTestId('parallel-badge');
    expect(badges).toHaveLength(2); // 两件活互为并行
    expect(badges[0].getAttribute('title')).toMatch(/客服·会话轮询/);
    expect(screen.getAllByText(/同时在跑：/).length).toBeGreaterThan(0);
  });

  it('不重叠的活不标并行', () => {
    renderTable([at(2, 90), at(6, 90)]);
    expect(screen.queryAllByTestId('parallel-badge')).toHaveLength(0);
  });

  it('被挡住的活在说明列写原因', () => {
    renderTable([at(19, 10, { status: 'blocked', blocked_reason: '素材待审核' })]);
    expect(screen.getByTestId('task-row')).toHaveTextContent('素材待审核');
  });

  it('失败的活说人话而不是机器码', () => {
    renderTable([at(14, 45, { status: 'failed' })]);
    const row = screen.getByTestId('task-row');
    expect(row).toHaveTextContent('机器失联');
    expect(row).toHaveTextContent(/上报/);
  });

  it('表头显示当天件数、已完成、待跑与额度', () => {
    renderTable([at(2, 90, { status: 'done' }), at(22, 90)], {
      quotas: [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }],
    });
    const box = screen.getByTestId('device-task-table');
    expect(box).toHaveTextContent(/共\s*2\s*件/);
    expect(box).toHaveTextContent(/已完成\s*1/);
    expect(box).toHaveTextContent(/待跑\s*1/);
    expect(box).toHaveTextContent('14/55单');
    expect(box).toHaveTextContent('还能加 41');
  });

  it('已完成的任务名划掉，一眼分得出做没做', () => {
    renderTable([at(8, 60, { status: 'done', title: '做完的活' })]);
    expect(screen.getByText('做完的活').className).toMatch(/line-through/);
  });

  it('没排程与这天没安排给不同提示', () => {
    const { unmount } = renderTable([], { noSchedule: true });
    expect(screen.getByText('这台机还没有排程')).toBeInTheDocument();
    unmount();
    renderTable([]);
    expect(screen.getByText('这天没有安排')).toBeInTheDocument();
  });

  it('正在跑的任务显示在表头，设备名链到实时画面', () => {
    renderTable([at(8, 60)], { runningText: '正在跑：触达·单#77（第 1/2 步）' });
    const box = screen.getByTestId('device-task-table');
    expect(within(box).getByText(/正在跑：触达·单#77/)).toBeInTheDocument();
    expect(within(box).getAllByRole('link')[0]).toHaveAttribute('href', '/dashboard/workers/x');
  });

  it('只显示指定那天的活，别的天不混进来', () => {
    const tomorrow: ScheduleSlot = {
      ...at(8, 60),
      id: 'tmr',
      title: '明天的活',
      planned_at: new Date(dayRange(1).start + 8 * HOUR).toISOString(),
    };
    renderTable([at(8, 60, { title: '今天的活' }), tomorrow]);
    expect(screen.getAllByTestId('task-row')).toHaveLength(1);
    expect(screen.getByTestId('task-row')).toHaveTextContent('今天的活');
  });
});
