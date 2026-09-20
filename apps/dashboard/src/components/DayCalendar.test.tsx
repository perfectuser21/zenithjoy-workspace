import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import DayCalendar, { layout, HOUR_PX } from './DayCalendar';
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

describe('日历排版', () => {
  it('块的位置和高度按开始时刻与时长算', () => {
    const [b] = layout([at(6, 90)], 0);
    expect(b.top).toBe(6 * HOUR_PX);
    expect(b.height).toBe(1.5 * HOUR_PX);
  });

  it('不重叠的活各占满宽，只有一列', () => {
    const blocks = layout([at(2, 60), at(8, 60)], 0);
    expect(blocks.map((b) => b.cols)).toEqual([1, 1]);
    expect(blocks.map((b) => b.col)).toEqual([0, 0]);
  });

  it('两件活同时段就分两列并排', () => {
    const blocks = layout([at(8, 14 * 60, { id: 'a' }), at(10, 600, { id: 'c' })], 0);
    expect(blocks.map((b) => b.cols)).toEqual([2, 2]);
    expect(blocks.map((b) => b.col)).toEqual([0, 1]);
  });

  it('三件活压在一起就分三列', () => {
    const blocks = layout([at(9, 180, { id: 'a' }), at(9, 120, { id: 'b' }), at(10, 60, { id: 'c' })], 0);
    expect(blocks.every((b) => b.cols === 3)).toBe(true);
    expect(blocks.map((b) => b.col).sort()).toEqual([0, 1, 2]);
  });

  it('A 和 C 不重叠时 C 复用 A 的列，不白白多开一列', () => {
    // A 09:00-10:00，B 09:30-12:00，C 10:00-11:00：A 与 C 不重叠
    const blocks = layout([at(9, 60, { id: 'a' }), at(9, 150, { id: 'b' }), at(10, 60, { id: 'c' })], 0);
    expect(blocks.every((b) => b.cols === 2)).toBe(true);
    const byId = Object.fromEntries(blocks.map((b) => [b.slot.id, b.col]));
    expect(byId[blocks[0].slot.id]).toBe(0);
    expect(blocks[2].col).toBe(0); // C 回到第一列
  });

  it('块按开始时刻升序排出来', () => {
    const blocks = layout([at(22, 60, { id: 'late' }), at(3, 60, { id: 'early' })], 0);
    expect(blocks[0].slot.title).toBe('3 点的活');
    expect(blocks[1].slot.title).toBe('22 点的活');
  });

  it('跨天的活截断在 24 点，但记下真实结束时刻', () => {
    const [b] = layout([at(22, 150, {})], 0); // 22:00 + 2.5h → 次日 00:30
    expect(b.top + b.height).toBe(24 * HOUR_PX);
    expect(b.endsNextDay).toBe(true);
    expect(b.endText).toBe('00:30');
  });

  it('不跨天的活不标次日', () => {
    const [b] = layout([at(22, 90)], 0);
    expect(b.endsNextDay).toBe(false);
    expect(b.endText).toBe('23:30');
  });

  it('只排指定那天的活，别的天不混进来', () => {
    const tomorrow: ScheduleSlot = {
      ...at(8, 60),
      id: 'tmr',
      title: '明天的活',
      planned_at: new Date(dayRange(1).start + 8 * HOUR).toISOString(),
    };
    expect(layout([at(8, 60, { id: 'today' }), tomorrow], 0)).toHaveLength(1);
    expect(layout([at(8, 60, { id: 'today' }), tomorrow], 1)[0].slot.title).toBe('明天的活');
  });
});

describe('日历组件', () => {
  it('画出 0 到 24 点的整点刻度', () => {
    render(<DayCalendar slots={[]} dayOffset={0} />);
    const ticks = screen.getAllByTestId('hour-tick');
    expect(ticks).toHaveLength(24);
    expect(ticks[0]).toHaveTextContent('00:00');
    expect(ticks[23]).toHaveTextContent('23:00');
  });

  it('容器固定高度且自己滚，页面不会被撑长', () => {
    render(<DayCalendar slots={[at(8, 60)]} dayOffset={0} />);
    const box = screen.getByTestId('calendar-scroll');
    expect(box.className).toMatch(/overflow-y-auto/);
    expect(box.className).toMatch(/h-\[/);
  });

  it('每件活一个块，写出名字和起止时间', () => {
    render(<DayCalendar slots={[at(8, 90, { title: '触达 · 私信今日额度' })]} dayOffset={0} />);
    const block = screen.getByTestId('cal-block');
    expect(block).toHaveTextContent('触达 · 私信今日额度');
    expect(block).toHaveTextContent('08:00');
    expect(block).toHaveTextContent('09:30');
  });

  it('并排的两块各占一半宽', () => {
    render(<DayCalendar slots={[at(8, 600, { id: 'a' }), at(9, 60, { id: 'b' })]} dayOffset={0} />);
    const blocks = screen.getAllByTestId('cal-block');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.style.width).toBe('50%');
    expect(blocks[0].style.left).toBe('0%');
    expect(blocks[1].style.left).toBe('50%');
  });

  it('跨天的块标出真实结束时刻', () => {
    render(<DayCalendar slots={[at(23, 90)]} dayOffset={0} />);
    expect(screen.getByTestId('cal-block')).toHaveTextContent('次日 00:30');
  });

  it('失败的活说人话而不是机器码', () => {
    render(<DayCalendar slots={[at(14, 45, { status: 'failed' })]} dayOffset={0} />);
    const block = screen.getByTestId('cal-block');
    expect(block).toHaveTextContent('机器失联');
    expect(block.textContent).not.toMatch(/executor_lost/);
  });

  it('被挡住的活写出原因', () => {
    render(<DayCalendar slots={[at(19, 10, { status: 'blocked', blocked_reason: '素材待审核' })]} dayOffset={0} />);
    expect(screen.getByTestId('cal-block')).toHaveTextContent('素材待审核');
  });

  it('今天画「现在」这条线，别的天不画', () => {
    const { unmount } = render(<DayCalendar slots={[]} dayOffset={0} />);
    expect(screen.getByTestId('now-line')).toBeInTheDocument();
    unmount();
    render(<DayCalendar slots={[]} dayOffset={1} />);
    expect(screen.queryByTestId('now-line')).not.toBeInTheDocument();
  });

  it('这天没排活时给一句话，不留一片空白', () => {
    render(<DayCalendar slots={[]} dayOffset={0} />);
    expect(screen.getByText('这天没有安排')).toBeInTheDocument();
  });

  it('头上给出当天件数与已完成、待跑', () => {
    render(<DayCalendar slots={[at(2, 60, { status: 'done' }), at(8, 60)]} dayOffset={0} />);
    const head = screen.getByTestId('calendar-head');
    expect(within(head).getByText(/共\s*2\s*件/)).toBeInTheDocument();
    expect(head).toHaveTextContent(/已完成\s*1/);
    expect(head).toHaveTextContent(/待跑\s*1/);
  });
});
