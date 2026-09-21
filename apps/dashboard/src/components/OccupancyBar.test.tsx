/**
 * 24 小时占用条（Brain task fdbd0238）
 *
 * 主理人：「我觉得你这个不是很明显。比如说应该是左边是一个已经排的东西，然后右边是不是
 * 能够看出这几个地方是空的、空的、空的？你现在写的这我也不知道他妈的能空多少、差多少，
 * 你知道吧？就很烦，不明显。」
 *
 * 文字给不了量感 —— 空档得用长度表达。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import OccupancyBar, { segments, BAR_LABEL_MIN_MINUTES, BAR_MERGE_GAP_MINUTES } from './OccupancyBar';
import { dayRange, type ScheduleSlot } from '../api/schedule.api';

afterEach(cleanup);

const HOUR = 3600_000;
const atDay = (day: number, hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: `s-${day}-${hh}-${extra.id ?? ''}`,
  title: `${hh} 点的活`,
  dept: '智能获客',
  planned_at: new Date(dayRange(day).start + hh * HOUR).toISOString(),
  est_minutes: minutes,
  source: 'recurring',
  status: 'queued',
  ...extra,
});

const NOON = dayRange(0).start + 12 * HOUR;

describe('把一天切成占用与空白两种段', () => {
  it('排了活的地方是占用，没排的是空白，两种交替铺满一天', () => {
    const segs = segments([atDay(1, 8, 60), atDay(1, 12, 60, { id: 'b' })], 1, NOON);
    expect(segs.map((s) => s.kind)).toEqual(['free', 'busy', 'free', 'busy', 'free']);
    // 百分比合起来正好是一整天
    const total = segs.reduce((n, s) => n + s.topPct + 0, 0);
    expect(Math.round(segs.reduce((n, s) => n + s.heightPct, 0))).toBe(100);
    expect(total).toBeGreaterThan(0);
  });

  it('占用段的高度按时长成比例：一小时正好是一天的 1/24', () => {
    const segs = segments([atDay(1, 8, 60)], 1, NOON);
    const busy = segs.find((s) => s.kind === 'busy')!;
    expect(busy.heightPct).toBeCloseTo(100 / 24, 3);
    expect(busy.topPct).toBeCloseTo((8 / 24) * 100, 3);
  });

  it('一天没排活就是一整条空白', () => {
    const segs = segments([], 1, NOON);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('free');
    expect(segs[0].heightPct).toBe(100);
  });

  it('排满一整天就没有空白段', () => {
    const full = Array.from({ length: 24 }, (_, h) => atDay(1, h, 60, { id: `h${h}` }));
    expect(segments(full, 1, NOON).every((s) => s.kind === 'busy')).toBe(true);
  });

  it('时间上挨着的活合成一整段，不会碎成一堆细条', () => {
    const segs = segments([atDay(1, 8, 60), atDay(1, 9, 60, { id: 'b' }), atDay(1, 10, 60, { id: 'c' })], 1, NOON);
    const busy = segs.filter((s) => s.kind === 'busy');
    expect(busy).toHaveLength(1);
    expect(busy[0].heightPct).toBeCloseTo((3 / 24) * 100, 3);
  });

  it('只隔了小缝的活并成一段，条子不会碎成一堆横条纹', () => {
    // 08:00-08:12 与 08:30-08:35 之间只隔 18 分钟（触达单之间的常态）
    const a = atDay(1, 8, 12, { id: 'a' });
    const b: ScheduleSlot = { ...atDay(1, 8, 5, { id: 'b' }), planned_at: new Date(dayRange(1).start + 8 * HOUR + 30 * 60_000).toISOString() };
    const busy = segments([a, b], 1, NOON).filter((s) => s.kind === 'busy');
    expect(busy).toHaveLength(1);
  });

  it('缝大到能塞单了就不合并，该留白还是留白', () => {
    // 08:00-08:12 与 09:00-09:05 之间隔 48 分钟，超过合并阈值
    const a = atDay(1, 8, 12, { id: 'a' });
    const b = atDay(1, 9, 5, { id: 'b' });
    const segs = segments([a, b], 1, NOON);
    expect(segs.filter((s) => s.kind === 'busy')).toHaveLength(2);
    const mid = segs.find((s) => s.kind === 'free' && s.startText === '08:12')!;
    expect(mid.minutes).toBe(48);
    expect(mid.minutes).toBeGreaterThan(BAR_MERGE_GAP_MINUTES);
  });

  it('重叠的活也只算一段占用，不会把条画出两倍长', () => {
    const segs = segments([atDay(1, 8, 180), atDay(1, 9, 60, { id: 'b' })], 1, NOON);
    const busy = segs.filter((s) => s.kind === 'busy');
    expect(busy).toHaveLength(1);
    expect(busy[0].heightPct).toBeCloseTo((3 / 24) * 100, 3);
  });

  it('空白段带上空多久与能塞几单，够大的才配文字', () => {
    const segs = segments([atDay(1, 8, 60)], 1, NOON);
    const big = segs.find((s) => s.kind === 'free' && s.minutes >= BAR_LABEL_MIN_MINUTES)!;
    expect(big.minutes).toBeGreaterThanOrEqual(BAR_LABEL_MIN_MINUTES);
    expect(big.canFit).toBeGreaterThan(0);
    expect(big.showLabel).toBe(true);
  });

  it('今天已经过去的那截空白标成已过，不算能加', () => {
    const segs = segments([atDay(0, 8, 60)], 0, NOON);
    const morning = segs.find((s) => s.kind === 'free' && s.startText === '00:00')!;
    expect(morning.past).toBe(true);
    expect(morning.canFit).toBe(0);
  });
});

describe('占用条组件', () => {
  const renderBar = (slots: ScheduleSlot[], dayOffset = 1) =>
    render(<OccupancyBar slots={slots} dayOffset={dayOffset} />);

  it('画出占用段与空白段，空白看得出来', () => {
    renderBar([atDay(1, 8, 60), atDay(1, 12, 60, { id: 'b' })]);
    expect(screen.getAllByTestId('bar-busy')).toHaveLength(2);
    expect(screen.getAllByTestId('bar-free').length).toBeGreaterThan(0);
  });

  it('大块空白上直接写空多久，不用去表里找', () => {
    renderBar([atDay(1, 8, 60)]);
    const labels = screen.getAllByTestId('bar-free').map((e) => e.textContent).join(' ');
    expect(labels).toMatch(/空\s*\d+\s*小时/);
  });

  it('刻度从 0 点标到 24 点', () => {
    renderBar([]);
    const ticks = screen.getAllByTestId('bar-tick');
    expect(ticks[0]).toHaveTextContent('00');
    expect(ticks[ticks.length - 1]).toHaveTextContent('24');
  });

  it('今天画现在线，别的天不画', () => {
    const { unmount } = renderBar([], 0);
    expect(screen.getByTestId('bar-now')).toBeInTheDocument();
    unmount();
    renderBar([], 1);
    expect(screen.queryByTestId('bar-now')).not.toBeInTheDocument();
  });

  it('点空白段能把表格滚到那个时刻', () => {
    const onPick = vi.fn();
    render(<OccupancyBar slots={[atDay(1, 8, 60)]} dayOffset={1} onPickGap={onPick} />);
    fireEvent.click(screen.getAllByTestId('bar-free')[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(typeof onPick.mock.calls[0][0]).toBe('number');
  });

  it('已经跑完的占用块压暗，没跑的保持实色，一眼看出进度到哪', () => {
    // 08:00-09:00 已过（现在按真实时钟，dayOffset=-1 整天都已过；dayOffset=1 整天都没跑）
    const { unmount } = renderBar([atDay(-1, 8, 60)], -1);
    const gone = screen.getAllByTestId('bar-busy')[0];
    unmount();
    renderBar([atDay(1, 8, 60)], 1);
    const future = screen.getAllByTestId('bar-busy')[0];
    expect(gone.className).not.toBe(future.className);
    expect(gone.getAttribute('data-past')).toBe('1');
    expect(future.getAttribute('data-past')).toBe('0');
  });

  it('划到某一段会告诉外面是哪个时刻，用来联动表格', () => {
    const onHover = vi.fn();
    render(<OccupancyBar slots={[atDay(1, 8, 60)]} dayOffset={1} onHoverAt={onHover} />);
    fireEvent.mouseEnter(screen.getAllByTestId('bar-busy')[0]);
    expect(typeof onHover.mock.calls[0][0]).toBe('number');
    fireEvent.mouseLeave(screen.getAllByTestId('bar-busy')[0]);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('外面告诉它划到了哪个时刻，对应那一段亮起来', () => {
    const start = dayRange(1).start + 8 * HOUR;
    render(<OccupancyBar slots={[atDay(1, 8, 60)]} dayOffset={1} highlightAt={start + 10 * 60_000} />);
    expect(screen.getAllByTestId('bar-busy')[0].getAttribute('data-hot')).toBe('1');
  });

  it('条子顶上一句话给出空了多少、还能加多少', () => {
    renderBar([atDay(1, 8, 60)]);
    const head = screen.getByTestId('bar-head');
    expect(head.textContent).toMatch(/空\s*\d+/);
    expect(head.textContent).toMatch(/能加\s*\d+\s*单/);
  });
});
