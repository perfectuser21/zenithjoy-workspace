import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DayTimeline, { blockGeometry, nowMarker, HourRuler } from './DayTimeline';
import { dayRange, type ScheduleSlot } from '../api/schedule.api';

afterEach(cleanup);

const HOUR = 3600_000;
const slotAt = (hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => {
  const d = new Date(dayRange(0).start + hh * HOUR);
  return {
    id: `s-${hh}-${minutes}`,
    title: `${hh} 点的活`,
    dept: '智能获客',
    planned_at: d.toISOString(),
    est_minutes: minutes,
    source: 'recurring',
    status: 'queued',
    ...extra,
  };
};

describe('色块定位', () => {
  it('按时刻定左边距、按时长定宽度（都是整天的百分比）', () => {
    const start = dayRange(0).start;
    const a = blockGeometry(slotAt(6, 60), start);
    expect(a.left).toBeCloseTo(25, 6);
    expect(a.width).toBeCloseTo(100 / 24, 6); // 1 小时 = 一天的 1/24
    const b = blockGeometry(slotAt(12, 720), start);
    expect(b.left).toBeCloseTo(50, 6);
    expect(b.width).toBeCloseTo(50, 6); // 12 小时 = 半天
  });

  it('跨到次日的活截断在 24 点，不溢出轴外', () => {
    const g = blockGeometry(slotAt(22, 6 * 60), dayRange(0).start); // 22:00 跑 6 小时
    expect(g.left).toBeCloseTo(100 - 100 / 12, 5);
    expect(g.left + g.width).toBeLessThanOrEqual(100);
  });

  it('极短的活也留得住最小宽度，否则点不到', () => {
    expect(blockGeometry(slotAt(9, 1), dayRange(0).start).width).toBeGreaterThanOrEqual(0.8);
  });
});

describe('当前时刻红线', () => {
  it('只在今天这条轴上画', () => {
    const today = dayRange(0).start;
    expect(nowMarker(today, today + 6 * HOUR)).toBeCloseTo(25, 5);
    expect(nowMarker(today, today - HOUR)).toBeNull(); // 还没到这天
    expect(nowMarker(today, today + 25 * HOUR)).toBeNull(); // 已过这天
  });
});

describe('DayTimeline 组件', () => {
  it('每个活渲染一个可点的色块，标题带时刻与状态', () => {
    render(<DayTimeline slots={[slotAt(8, 60), slotAt(22, 90, { status: 'done' })]} dayStart={dayRange(0).start} />);
    const blocks = screen.getAllByTestId('timeline-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveAttribute('data-status', 'queued');
    expect(blocks[1]).toHaveAttribute('data-status', 'done');
    expect(blocks[0].getAttribute('title')).toMatch(/08:00 8 点的活/);
    expect(blocks[1].getAttribute('title')).toMatch(/已完成/);
  });

  it('被挡住的活在标题里带出原因', () => {
    render(
      <DayTimeline
        slots={[slotAt(19, 10, { status: 'blocked', blocked_reason: '素材待审核' })]}
        dayStart={dayRange(0).start}
      />,
    );
    expect(screen.getByTestId('timeline-block').getAttribute('title')).toMatch(/被挡住：素材待审核/);
  });

  it('点色块回调该条活', () => {
    const onPick = vi.fn();
    render(<DayTimeline slots={[slotAt(8, 60)]} dayStart={dayRange(0).start} onPick={onPick} />);
    fireEvent.click(screen.getByTestId('timeline-block'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ title: '8 点的活' }));
  });

  it('今天有红线，别的日子没有', () => {
    const { unmount } = render(<DayTimeline slots={[]} dayStart={dayRange(0).start} />);
    expect(screen.getByTestId('now-marker')).toBeInTheDocument();
    unmount();
    render(<DayTimeline slots={[]} dayStart={dayRange(3).start} />);
    expect(screen.queryByTestId('now-marker')).toBeNull();
  });

  it('紧凑模式（周视图）不写文字，只留色块', () => {
    render(<DayTimeline slots={[slotAt(8, 600)]} dayStart={dayRange(0).start} compact />);
    expect(screen.getByTestId('timeline-block')).toHaveTextContent('');
  });

  it('刻度尺标出整点', () => {
    render(<HourRuler />);
    const ruler = screen.getByTestId('hour-ruler');
    expect(ruler).toHaveTextContent('0点');
    expect(ruler).toHaveTextContent('12');
    expect(ruler).toHaveTextContent('24');
  });
});
