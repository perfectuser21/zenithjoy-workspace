import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DispatchJobDialog, { windowPresets, isOutboundDept } from './DispatchJobDialog';
import type { ScheduleDevice } from '../api/schedule.api';

const dispatchJob = vi.fn();
vi.mock('../api/schedule.api', async (orig) => ({
  ...(await orig<typeof import('../api/schedule.api')>()),
  dispatchJob: (...a: unknown[]) => dispatchJob(...a),
}));

afterEach(cleanup);
beforeEach(() => { dispatchJob.mockReset(); dispatchJob.mockResolvedValue({ id: 'new-1' }); });

const devices = [
  { agent_id: 'a1', name: '金诺工作机', serial: 'ANGYVB4227006983', online: true, depts: [], quotas: [], slots: [] },
  { agent_id: 'a2', name: '悦升工作机', serial: 'ANGYVB4402004137', online: false, depts: [], quotas: [], slots: [] },
] as unknown as ScheduleDevice[];

const open = (over = {}) =>
  render(<DispatchJobDialog devices={devices} defaultAgentId="a1" onClose={() => {}} onDone={() => {}} {...over} />);

describe('窗口语义：主理人排的是窗口不是时刻', () => {
  it('对外动作的部门被识别出来（获客/新媒体/私域碰平台，剪辑不碰）', () => {
    expect(isOutboundDept('智能获客')).toBe(true);
    expect(isOutboundDept('新媒体部')).toBe(true);
    expect(isOutboundDept('私域客服')).toBe(true);
    expect(isOutboundDept('视频剪辑')).toBe(false);
  });

  it('给对外动作的预设窗口一律不窄于 30 分钟（铁律 27bb6d1a）', () => {
    for (const p of windowPresets('智能获客')) {
      expect(p.minutes, `预设「${p.label}」只有 ${p.minutes} 分钟`).toBeGreaterThanOrEqual(30);
    }
  });

  it('对内动作允许"就现在"这种精确窗口', () => {
    expect(windowPresets('视频剪辑').some((p) => p.minutes === 0)).toBe(true);
  });
});

describe('派单面板', () => {
  it('列出可选设备，默认选中当前那台', () => {
    open();
    const sel = screen.getByLabelText('设备') as HTMLSelectElement;
    expect(sel.value).toBe('a1');
    expect(screen.getByRole('option', { name: /金诺工作机/ })).toBeTruthy();
  });

  it('离线设备在选项里标出来——允许排，但要让人知道到点可能不跑', () => {
    open();
    expect(screen.getByRole('option', { name: /悦升工作机.*离线/ })).toBeTruthy();
  });

  it('派单把窗口换算成起止时刻传下去，并带上动作参数', async () => {
    open();
    fireEvent.change(screen.getByLabelText('关键词 / 参数'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    await waitFor(() => expect(dispatchJob).toHaveBeenCalled());
    const arg = dispatchJob.mock.calls[0][0];
    expect(arg.agent_id).toBe('a1');
    expect(Date.parse(arg.window_end) - Date.parse(arg.window_start)).toBeGreaterThanOrEqual(30 * 60_000);
    expect(arg.params.action).toBeTruthy();
    expect(arg.params.arg).toBe('AI训练师');
  });

  it('后端说窗口太窄时，把那句人话原样显示给用户', async () => {
    dispatchJob.mockRejectedValueOnce(new Error('对外动作至少留 30 分钟窗口——固定整点发送等于向平台自首'));
    open();
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/30 分钟窗口/);
  });

  it('提交中按钮禁用，防手抖连点派出两批', async () => {
    let release!: () => void;
    dispatchJob.mockImplementationOnce(() => new Promise((r) => { release = () => r({ id: 'x' }); }));
    open();
    const btn = screen.getByRole('button', { name: '派下去' });
    fireEvent.click(btn);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    release();
  });

  it('派成功后回调通知页面刷新', async () => {
    const onDone = vi.fn();
    open({ onDone });
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('没有设备可选时说明白，而不是给一个空下拉让人点了报错', () => {
    render(<DispatchJobDialog devices={[]} defaultAgentId={null} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/没有可派单的设备/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '派下去' })).toBeNull();
  });
});
