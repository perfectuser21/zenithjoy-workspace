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

describe('工作机页内嵌时间轴（主理人：不要再弄个新页面）', () => {
  it('每台有排程的设备渲染一条 24 小时时间轴', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('gantt-track').length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByTestId('gantt-block').length).toBeGreaterThan(0);
  });

  it('没排程的设备也占一行，只是轨道为空', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('没排程的机')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('gantt-row').length).toBe(3));
  });

  it('日视图一台一条轴；切到周视图变成 7 条', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('gantt-track').length).toBe(3)); // 三台各一条轨道
    fireEvent.click(screen.getByRole('button', { name: '周' }));
    await waitFor(() => expect(screen.getAllByTestId('gantt-track').length).toBe(21)); // 3 台 × 7 天
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

  it('翻到昨天时不画当前时刻红线', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('gantt-now').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByLabelText('前一天'));
    await waitFor(() => expect(screen.getByRole('button', { name: '昨天' })).toBeInTheDocument());
    expect(screen.queryByTestId('gantt-now')).toBeNull();
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

  it('顶部汇总当天件数，设备列给出额度与待跑', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    await waitFor(() => expect(container).toHaveTextContent(/共\s*\d+\s*件/));
    expect(container).toHaveTextContent(/已完成\s*\d+/);
    expect(container).toHaveTextContent(/待跑\s*\d+/);
    const cell = screen.getByText('金诺工作机').closest('div') as HTMLElement;
    expect(cell.parentElement).toHaveTextContent('14/55单');
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

  it('周视图每条子轨道标出是哪天', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('金诺工作机')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '周' }));
    await waitFor(() => expect(screen.getAllByText('今天').length).toBeGreaterThan(0));
    expect(screen.getAllByText('明天').length).toBeGreaterThan(0);
  });

  it('设备名与时间刻度固定（sticky），横滑时不跑掉', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('schedule-gantt')).toBeInTheDocument());
    expect(screen.getByText('设备').className).toMatch(/sticky/);
    const cell = screen.getByText('金诺工作机').closest('div')!.parentElement!;
    expect(cell.className).toMatch(/sticky/);
  });
});
