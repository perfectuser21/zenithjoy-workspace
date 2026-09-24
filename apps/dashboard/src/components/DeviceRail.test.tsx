/**
 * 设备左栏（Brain task c297df37）
 *
 * 主理人：「手机框你改了，我也没觉得改得很好看。」形态三选一里他挑了
 * 「缩小成小窗，下面补数据」——画面是配角，这台机今天干得怎么样才是主角。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DeviceRail from './DeviceRail';
import { dayRange, type ScheduleSlot } from '../api/schedule.api';

afterEach(cleanup);

const HOUR = 3600_000;
const at = (hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: `s-${hh}-${extra.id ?? ''}`,
  title: `${hh} 点的活`,
  dept: '智能获客',
  planned_at: new Date(dayRange(0).start + hh * HOUR).toISOString(),
  est_minutes: minutes,
  source: 'recurring',
  status: 'queued',
  read_only: false,
  ...extra,
});

const renderRail = (props: Partial<React.ComponentProps<typeof DeviceRail>> = {}) =>
  render(
    <MemoryRouter>
      <DeviceRail
        name="金诺工作机"
        serial="ANGYVB4227006983"
        online
        href="/dashboard/workers/x"
        liveUrl="/api/workers/x/live"
        slots={[]}
        dayOffset={0}
        {...props}
      />
    </MemoryRouter>,
  );

describe('设备左栏', () => {
  it('画面是小窗，不再占满一整列', () => {
    renderRail();
    const shot = screen.getByTestId('rail-live');
    // 宽度写死在小窗尺寸上，别又长回 300px
    expect(shot.className).toMatch(/w-\[1\d\dpx\]/);
    expect(screen.getByAltText('实时画面')).toHaveAttribute('src', '/api/workers/x/live');
  });

  it('设备名与序列号在栏顶，不再另占一行', () => {
    renderRail();
    const head = screen.getByTestId('rail-head');
    expect(head).toHaveTextContent('金诺工作机');
    expect(head).toHaveTextContent('ANGYVB4227006983');
  });

  it('画面下面列出这台机今天的关键数字', () => {
    renderRail({
      slots: [
        at(2, 60, { id: 'a', status: 'done' }),
        at(8, 60, { id: 'b', status: 'failed' }),
        at(20, 60, { id: 'c' }),
      ],
      quotas: [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }],
    });
    const stats = screen.getByTestId('rail-stats');
    expect(stats).toHaveTextContent(/已完成\s*1/);
    expect(stats).toHaveTextContent(/失败\s*1/);
    expect(stats).toHaveTextContent(/待跑\s*1/);
    expect(stats).toHaveTextContent('14/55单');
  });

  it('正在跑的写出第几步，空闲就明说空闲', () => {
    const { unmount } = renderRail({ runningText: '触达·单#77（第 1/2 步）' });
    expect(screen.getByTestId('rail-stats')).toHaveTextContent('第 1/2 步');
    unmount();
    renderRail();
    expect(screen.getByTestId('rail-stats')).toHaveTextContent('空闲');
  });

  it('点画面能放大，再点一次关掉', () => {
    renderRail();
    expect(screen.queryByTestId('live-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('rail-live'));
    const modal = screen.getByTestId('live-modal');
    expect(within(modal).getByAltText('实时画面（放大）')).toHaveAttribute('src', '/api/workers/x/live');
    fireEvent.click(screen.getByTestId('live-modal-backdrop'));
    expect(screen.queryByTestId('live-modal')).toBeNull();
  });

  it('放大时按 Esc 也能关', () => {
    renderRail();
    fireEvent.click(screen.getByTestId('rail-live'));
    expect(screen.getByTestId('live-modal')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('live-modal')).toBeNull();
  });

  it('离线的机子标出来，别让人对着不动的画面等', () => {
    renderRail({ online: false });
    expect(screen.getByTestId('rail-head')).toHaveTextContent('离线');
  });

  it('留一个去看步骤流的入口', () => {
    renderRail();
    expect(screen.getByRole('link', { name: /步骤流/ })).toHaveAttribute('href', '/dashboard/workers/x');
  });

  it('换设备时把放大的画面关掉，不然会对着上一台的画面', () => {
    const { rerender } = renderRail();
    fireEvent.click(screen.getByTestId('rail-live'));
    expect(screen.getByTestId('live-modal')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <DeviceRail name="小龙虾机" online href="/dashboard/workers/y" liveUrl="/api/workers/y/live" slots={[]} dayOffset={0} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('live-modal')).toBeNull();
  });

  it('点画面会告诉外面一声，用来暂停轮询之类', () => {
    const onZoom = vi.fn();
    renderRail({ onZoomChange: onZoom });
    fireEvent.click(screen.getByTestId('rail-live'));
    expect(onZoom).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onZoom).toHaveBeenLastCalledWith(false);
  });
});
