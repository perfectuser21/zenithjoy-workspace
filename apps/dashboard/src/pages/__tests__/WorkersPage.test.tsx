/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../api/workers.api', () => ({ fetchWorkers: vi.fn() }));
import { fetchWorkers } from '../../api/workers.api';
import WorkersPage from '../WorkersPage';
beforeEach(() => vi.clearAllMocks());
const workers = [
  { id: 'a1', agent_id: 'ag1', hostname: 'MAA-AN00', nickname: '小龙虾', os_type: 'android', status: 'online',
    running: { task_id: 't1', title: '发布视频到抖音', current_step: 6, steps_total: 10 }, completed_today: 2, last_seen: 'x' },
  { id: 'w1', agent_id: 'ag2', hostname: 'XX-ROG', nickname: null, os_type: 'win32', status: 'offline', running: null, completed_today: 0, last_seen: 'x' },
];
describe('WorkersPage', () => {
  it('渲染 worker 卡片：类型徽章、在线态、正在执行第 x/y 步、今日完成、实时链接', async () => {
    (fetchWorkers as any).mockResolvedValue(workers);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('小龙虾')).toBeInTheDocument());
    expect(screen.getByText(/安卓/)).toBeInTheDocument();
    expect(screen.getByText(/Windows/)).toBeInTheDocument();
    expect(screen.getByText(/正在执行：发布视频到抖音/)).toBeInTheDocument();
    expect(screen.getByText(/第 6\/10 步/)).toBeInTheDocument();
    expect(screen.getByText('空闲')).toBeInTheDocument();
    expect(screen.getByText(/今日完成 2/)).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /实时/ });
    expect(links[0]).toHaveAttribute('href', '/dashboard/workers/a1');
  });
  it('无 worker → 空态引导', async () => {
    (fetchWorkers as any).mockResolvedValue([]);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/还没有工作机/)).toBeInTheDocument());
  });
});
