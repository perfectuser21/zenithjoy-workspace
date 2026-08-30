/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('../../api/workers.api', () => ({ fetchWorkerActivity: vi.fn(), workerLiveUrl: (id: string) => `/api/workers/${id}/live` }));
import { fetchWorkerActivity } from '../../api/workers.api';
import WorkerLivePage from '../WorkerLivePage';
function renderAt(id: string) {
  return render(<MemoryRouter initialEntries={[`/dashboard/workers/${id}`]}><Routes><Route path="/dashboard/workers/:agentId" element={<WorkerLivePage />} /></Routes></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => vi.useRealTimers());
describe('WorkerLivePage', () => {
  it('步骤列表按状态渲染 ✅/▶️/⬜，缩略图链接，画面 img 指向 live', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({
      current: { id: 't1', title: '发布视频到抖音', status: 'running', steps_total: 3, current_step: 2, started_at: 'x', finished_at: null, failed_step: null, error_code: null },
      steps: [
        { step_index: 0, title: '打开抖音', status: 'done', screenshot_url: '/api/workers/shots/t/t1/0.jpg' },
        { step_index: 1, title: '选视频', status: 'doing', screenshot_url: null },
        { step_index: 2, title: '发作品', status: 'pending', screenshot_url: null },
      ],
      history: [{ id: 'h1', title: '昨天的任务', status: 'failed', steps_total: 5, started_at: 'x', finished_at: 'y', failed_step: 3, error_code: 'adb_unreachable' }],
    });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('发布视频到抖音')).toBeInTheDocument());
    expect(screen.getByText('打开抖音').closest('li')).toHaveTextContent('✅');
    expect(screen.getByText('选视频').closest('li')).toHaveTextContent('▶️');
    expect(screen.getByText('发作品').closest('li')).toHaveTextContent('⬜');
    expect(screen.getByRole('img', { name: /实时画面/ })).toHaveAttribute('src', '/api/workers/a1/live');
    expect(screen.getByText(/adb_unreachable/)).toBeInTheDocument();
  });
  it('15 秒无新帧显示"画面不可用"', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({ current: null, steps: [], history: [] });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('空闲')).toBeInTheDocument());
    await act(async () => { vi.advanceTimersByTime(16_000); });
    expect(screen.getByText('画面不可用')).toBeInTheDocument();
  });
});
