import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../api/workers.api', () => ({
  fetchWorkers: vi.fn(),
  workerLiveUrl: (id: string) => `/api/workers/${id}/live`,
}));
import { fetchWorkers } from '../../api/workers.api';
import WorkersPage from '../WorkersPage';
beforeEach(() => vi.clearAllMocks());
const workers = [
  { id: 'a1', agent_id: 'ag1', hostname: 'MAA-AN00', nickname: '小龙虾', os_type: 'android', status: 'online',
    running: { task_id: 't1', title: '发布视频到抖音', current_step: 6, steps_total: 10 }, completed_today: 2, last_seen: 'x' },
  { id: 'w1', agent_id: 'ag2', hostname: 'XX-ROG', nickname: null, os_type: 'win32', status: 'offline', running: null, completed_today: 0, last_seen: 'x' },
];
describe('WorkersPage', () => {
  // 0920 三改：一屏只看一台，左画面右「按部门分组、固定高度内部滚动」的任务表
  it('一次只看一台机：顶部芯片列出所有机，正在跑第 x/y 步写在头上', async () => {
    (fetchWorkers as any).mockResolvedValue(workers);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('device-chip')).toHaveLength(2));
    expect(screen.getAllByTestId('dept-task-table')).toHaveLength(1);
    expect(screen.getByText(/正在跑：发布视频到抖音/)).toBeInTheDocument();
    expect(screen.getByText(/第 6\/10 步/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '看步骤流 →' })).toHaveAttribute('href', '/dashboard/workers/a1');
  });

  it('左边是这台机的实时画面', async () => {
    (fetchWorkers as any).mockResolvedValue(workers);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByAltText('实时画面')).toBeInTheDocument());
    expect(screen.getByAltText('实时画面')).toHaveAttribute('src', '/api/workers/a1/live');
  });

  it('无 worker → 空态引导', async () => {
    (fetchWorkers as any).mockResolvedValue([]);
    render(<MemoryRouter><WorkersPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/还没有工作机/)).toBeInTheDocument());
  });
});
