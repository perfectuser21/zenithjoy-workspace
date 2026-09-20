import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/workers.api', () => ({
  fetchWorkers: vi.fn(),
  workerLiveUrl: (id: string) => `/api/workers/${id}/live`,
}));
import { fetchWorkers } from '../../api/workers.api';
import WorkersPage from '../WorkersPage';

const W = (id: string, nickname: string, running: unknown = null) => ({
  id,
  agent_id: `a-${id}`,
  hostname: 'MAA-AN00',
  nickname,
  os_type: 'android' as const,
  status: 'online' as const,
  running,
  completed_today: 3,
  last_seen: new Date().toISOString(),
});

const JINO = '8e802deb-247d-4346-8028-03c265959431';
const YS = '657dfabc-802c-478d-9de3-c05b7db847df';
const XLX = '4c6c15fc-0b2f-479f-a32f-98ca33aaed1d';

beforeEach(() => {
  vi.clearAllMocks();
  (fetchWorkers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
    W(JINO, '金诺工作机'),
    W(YS, '悦升工作机'),
    W(XLX, '小龙虾机'),
    W('unknown-agent-id', '没排程的机'),
  ]);
});
afterEach(cleanup);

const renderPage = () => render(<MemoryRouter><WorkersPage /></MemoryRouter>);

describe('工作机页一屏一台机（主理人：左边一个手机，右边固定高度、按部门分组的 table）', () => {
  it('所有机器只出一排芯片，任务表同时只有一张', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(4));
    expect(screen.getAllByTestId('dept-task-table')).toHaveLength(1);
    // 日历视图已下线
    expect(screen.queryAllByTestId('day-calendar')).toHaveLength(0);
  });

  it('点另一台芯片就换成那台的画面和任务表', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByAltText('实时画面')).toHaveAttribute('src', `/api/workers/${JINO}/live`));
    fireEvent.click(screen.getByRole('button', { name: /小龙虾机/ }));
    await waitFor(() => expect(screen.getByAltText('实时画面')).toHaveAttribute('src', `/api/workers/${XLX}/live`));
    await waitFor(() => expect(screen.getByText('朋友圈 · 跟圈点赞')).toBeInTheDocument());
  });

  it('当天的活按部门分组，组内从早到晚，重叠的标出并行', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: /悦升工作机/ }));
    // 悦升机两个部门：智能获客与新媒体部
    await waitFor(() => expect(screen.getAllByTestId('dept-head').length).toBeGreaterThan(1));
    expect(screen.getAllByTestId('task-row').length).toBeGreaterThan(1);
    // 触达 08:00-22:00 与 20:00 的发布重叠 → 并行标记
    await waitFor(() => expect(screen.getAllByTestId('parallel-badge').length).toBeGreaterThan(0));
  });

  it('没排程的机切过去给提示，不是一片空白', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: /没排程的机/ }));
    await waitFor(() => expect(screen.getByText('这台机还没有排程')).toBeInTheDocument());
  });

  it('能前后翻天，并回到今天', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('后一天'));
    await waitFor(() => expect(screen.getByRole('button', { name: '明天' })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('后一天'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /月.*日 周/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '回到今天' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument());
  });

  it('翻到没排期的那天，表里写"这天没有安排"', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(4));
    fireEvent.click(screen.getByLabelText('前一天'));
    await waitFor(() => expect(screen.getByRole('button', { name: '昨天' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('这天没有安排')).toBeInTheDocument());
  });

  it('按部门筛选只留该部门的机，并自动切到留下的第一台', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: '私域客服' }));
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(1));
    expect(screen.getByRole('button', { name: /小龙虾机/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText('实时画面')).toHaveAttribute('src', `/api/workers/${XLX}/live`));
  });

  it('筛到没有设备时给一句话', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: '视频剪辑' }));
    await waitFor(() => expect(screen.getByText('没有匹配的设备')).toBeInTheDocument());
  });

  it('表头给出这台机当天的件数与额度', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('table-head')).toBeInTheDocument());
    const head = screen.getByTestId('table-head');
    await waitFor(() => expect(head).toHaveTextContent(/共\s*\d+\s*件/));
    expect(head).toHaveTextContent(/已完成\s*\d+/);
    expect(head).toHaveTextContent(/待跑\s*\d+/);
    expect(head).toHaveTextContent('14/55单');
  });

  it('表格整块固定高度、内部自己滚，页面不随任务变多往下长', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('table-scroll')).toBeInTheDocument());
    const box = screen.getByTestId('table-scroll');
    expect(box.className).toMatch(/overflow-y-auto/);
    expect(box.className).toMatch(/h-\[\d+px\]/);
  });

  it('正在跑的任务写在头上并能跳去看步骤流', async () => {
    (fetchWorkers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      W(JINO, '金诺工作机', { task_id: 't1', title: '触达·单#77', current_step: 1, steps_total: 2 }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/正在跑：触达·单#77/)).toBeInTheDocument());
    expect(screen.getByText(/第 1\/2 步/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '看步骤流 →' })).toHaveAttribute('href', `/dashboard/workers/${JINO}`);
  });

  it('样例数据期间挂提示', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/样例数据/)).toBeInTheDocument());
  });
});
