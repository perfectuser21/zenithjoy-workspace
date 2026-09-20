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
const XLX = '4c6c15fc-0b2f-479f-a32f-98ca33aaed1d';

beforeEach(() => {
  vi.clearAllMocks();
  (fetchWorkers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
    W(JINO, '金诺工作机'),
    W(XLX, '小龙虾机'),
    W('unknown-agent-id', '没排程的机'),
  ]);
});
afterEach(cleanup);

const renderPage = () => render(<MemoryRouter><WorkersPage /></MemoryRouter>);

describe('工作机页每台一张任务表（主理人：一个机子一个 table）', () => {
  it('每台设备各自一张表，不是挤在一起', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('device-task-table')).toHaveLength(3));
    expect(screen.getAllByTestId('task-row').length).toBeGreaterThan(0);
  });

  it('没排程的设备也有自己的表，给出提示', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('没排程的机')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('这台机还没有排程')).toBeInTheDocument());
  });

  it('并行的活在表里标出来', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    // 金诺机 08:00-22:00 触达 与 22:00 采收不重叠，但悦升机的发布落在触达时段内
    await waitFor(() => expect(screen.getAllByTestId('parallel-badge').length).toBeGreaterThan(0));
  });

  it('能前后翻天看每一天的活，并回到今天', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('后一天'));
    await waitFor(() => expect(screen.getByRole('button', { name: '明天' })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('后一天'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /月.*日 周/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '回到今天' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument());
  });

  it('翻到没有排期的那天，表里给出"这天没有安排"', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('前一天'));
    await waitFor(() => expect(screen.getByRole('button', { name: '昨天' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText('这天没有安排').length).toBeGreaterThan(0));
  });

  it('按部门筛选只留该部门的设备', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('小龙虾机')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '视频剪辑' }));
    await waitFor(() => expect(screen.getByText('没有匹配的设备')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '私域客服' }));
    await waitFor(() => expect(screen.getByText('小龙虾机')).toBeInTheDocument());
    expect(screen.queryByText('金诺工作机')).toBeNull();
  });

  it('顶部汇总与每张表的表头都给出件数与额度', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    await waitFor(() => expect(container).toHaveTextContent(/共\s*\d+\s*件/));
    expect(container).toHaveTextContent(/已完成\s*\d+/);
    expect(container).toHaveTextContent(/待跑\s*\d+/);
    expect(container).toHaveTextContent('14/55单');
  });

  it('正在跑的任务在行首显示到第几步', async () => {
    (fetchWorkers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      W(JINO, '金诺工作机', { task_id: 't1', title: '触达·单#77', current_step: 1, steps_total: 2 }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/正在跑：触达·单#77/)).toBeInTheDocument());
    expect(screen.getByText(/第 1\/2 步/)).toBeInTheDocument();
  });

  it('样例数据期间挂提示', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/样例数据/)).toBeInTheDocument());
  });

  it('设备名链到该机实时画面', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: '金诺工作机' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '金诺工作机' })).toHaveAttribute('href', `/dashboard/workers/${JINO}`);
  });

  it('表里每行都给出时间段、部门与状态', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('task-row').length).toBeGreaterThan(0));
    const row = screen.getAllByTestId('task-row')[0];
    expect(row.textContent).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
    expect(row.textContent).toMatch(/智能获客|新媒体部|私域客服|视频剪辑/);
    expect(row.textContent).toMatch(/待跑|已完成|进行中|失败|被挡住/);
  });
});
