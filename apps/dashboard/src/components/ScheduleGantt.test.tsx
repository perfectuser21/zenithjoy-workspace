import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScheduleGantt, { blockPx, nowPx, DAY_PX, HOUR_PX, type GanttRow } from './ScheduleGantt';
import { dayRange, type ScheduleDevice, type ScheduleSlot } from '../api/schedule.api';

afterEach(cleanup);

const HOUR = 3600_000;

const slotAt = (hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: `s-${hh}-${minutes}-${extra.status ?? 'q'}`,
  title: `${hh} 点的活`,
  dept: '智能获客',
  planned_at: new Date(dayRange(0).start + hh * HOUR).toISOString(),
  est_minutes: minutes,
  source: 'recurring',
  status: 'queued',
  ...extra,
});

const device = (slots: ScheduleSlot[]): ScheduleDevice => ({
  agent_id: 'dev-1',
  name: '金诺工作机',
  serial: 'SER1',
  online: true,
  depts: ['智能获客'],
  quotas: [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }],
  slots,
});

const row = (d: ScheduleDevice | undefined, days: number[] = [0]): GanttRow => ({
  key: 'k1',
  device: d,
  name: d?.name ?? '没排程的机',
  online: true,
  href: '/dashboard/workers/dev-1',
  days,
});

const renderGantt = (rows: GanttRow[], week = false) =>
  render(<MemoryRouter><ScheduleGantt rows={rows} week={week} /></MemoryRouter>);

describe('色块定位（像素）', () => {
  it('按时刻定左边距、按时长定宽度', () => {
    const start = dayRange(0).start;
    expect(blockPx(slotAt(6, 60), start)).toEqual({ left: 6 * HOUR_PX, width: HOUR_PX });
    expect(blockPx(slotAt(12, 720), start)).toEqual({ left: 12 * HOUR_PX, width: 12 * HOUR_PX });
  });

  it('跨到次日的活截断在当天末尾，不超出表宽', () => {
    const g = blockPx(slotAt(22, 6 * 60), dayRange(0).start);
    expect(g.left + g.width).toBeLessThanOrEqual(DAY_PX);
    expect(g.width).toBe(2 * HOUR_PX);
  });

  it('极短的活留最小宽度，否则看不见也点不到', () => {
    expect(blockPx(slotAt(9, 1), dayRange(0).start).width).toBeGreaterThanOrEqual(6);
  });
});

describe('当前时刻线', () => {
  it('只在今天那条轨道上画', () => {
    const today = dayRange(0).start;
    expect(nowPx(today, today + 6 * HOUR)).toBe(6 * HOUR_PX);
    expect(nowPx(today, today - HOUR)).toBeNull();
    expect(nowPx(today, today + 25 * HOUR)).toBeNull();
  });
});

describe('甘特表', () => {
  it('一台设备一条轨道，活渲染成色块并带时刻与状态提示', () => {
    renderGantt([row(device([slotAt(8, 60), slotAt(22, 90, { status: 'done' })]))]);
    expect(screen.getAllByTestId('gantt-row')).toHaveLength(1);
    expect(screen.getAllByTestId('gantt-track')).toHaveLength(1);
    const blocks = screen.getAllByTestId('gantt-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].getAttribute('title')).toMatch(/08:00 8 点的活/);
    expect(blocks[1].getAttribute('title')).toMatch(/已完成/);
    expect(blocks[1]).toHaveAttribute('data-status', 'done');
  });

  it('被挡住的活在提示里带出原因', () => {
    renderGantt([row(device([slotAt(19, 10, { status: 'blocked', blocked_reason: '素材待审核' })]))]);
    expect(screen.getByTestId('gantt-block').getAttribute('title')).toMatch(/被挡住：素材待审核/);
  });

  it('没排程的设备照样占一行，只是轨道空着', () => {
    renderGantt([row(undefined)]);
    expect(screen.getAllByTestId('gantt-row')).toHaveLength(1);
    expect(screen.getAllByTestId('gantt-track')).toHaveLength(1);
    expect(screen.queryAllByTestId('gantt-block')).toHaveLength(0);
  });

  it('设备列显示额度与待跑数，并链到实时画面', () => {
    renderGantt([row(device([slotAt(22, 90), slotAt(8, 60, { status: 'done' })]))]);
    const cell = screen.getByText('金诺工作机').closest('div')!.parentElement!;
    expect(cell).toHaveTextContent('14/55单');
    expect(cell).toHaveTextContent('待跑 1'); // 已完成的不算积压
    expect(screen.getByRole('link', { name: '金诺工作机' })).toHaveAttribute('href', '/dashboard/workers/dev-1');
  });

  it('左列与表头都是 sticky，横滑纵滚时不跑掉', () => {
    renderGantt([row(device([]))]);
    expect(screen.getByText('设备').className).toMatch(/sticky/);
    const cell = screen.getByText('金诺工作机').closest('div')!.parentElement!;
    expect(cell.className).toMatch(/sticky/);
  });

  it('外框高度固定，内容超出靠滚动而不是把页面撑长', () => {
    renderGantt([row(device([]))]);
    const scroller = screen.getByTestId('schedule-gantt').firstElementChild as HTMLElement;
    expect(scroller.className).toMatch(/overflow-auto/);
    expect(scroller.style.height).toBe('460px');
  });

  it('时间轴给足 24 小时的宽度，才需要横向滑', () => {
    renderGantt([row(device([]))]);
    expect(screen.getByTestId('gantt-track').style.width).toBe(`${DAY_PX}px`);
    expect(DAY_PX).toBeGreaterThan(1200); // 比常见屏宽宽，确保有得滑
  });

  it('周视图把一台设备展开成 7 条轨道，每条标出是哪天', () => {
    renderGantt([row(device([slotAt(8, 60)]), [0, 1, 2, 3, 4, 5, 6])], true);
    expect(screen.getAllByTestId('gantt-row')).toHaveLength(1);
    expect(screen.getAllByTestId('gantt-track')).toHaveLength(7);
    expect(screen.getByText('今天')).toBeInTheDocument();
    expect(screen.getByText('明天')).toBeInTheDocument();
  });

  it('日视图色块里写任务名，周视图只留色块不写字', () => {
    const { unmount } = renderGantt([row(device([slotAt(8, 600)]))]);
    expect(screen.getByTestId('gantt-block')).toHaveTextContent('8 点的活');
    unmount();
    renderGantt([row(device([slotAt(8, 600)]), [0])], true);
    expect(screen.getByTestId('gantt-block')).toHaveTextContent('');
  });

  it('没有匹配设备时给出空态', () => {
    renderGantt([]);
    expect(screen.getByText('没有匹配的设备')).toBeInTheDocument();
  });

  it('正在跑的任务显示在设备列，空闲时显示空闲', () => {
    renderGantt([{ ...row(device([])), runningText: '正在跑：触达·单#77（第 1/2 步）' }]);
    expect(screen.getByText(/正在跑：触达·单#77/)).toBeInTheDocument();
    cleanup();
    renderGantt([row(device([]))]);
    const cell = screen.getByText('金诺工作机').closest('div')!.parentElement!;
    expect(within(cell).getByText('空闲')).toBeInTheDocument();
  });
});
