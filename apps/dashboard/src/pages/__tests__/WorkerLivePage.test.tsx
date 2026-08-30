import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
      frame_age_ms: 500,
    });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('发布视频到抖音')).toBeInTheDocument());
    expect(screen.getByText('打开抖音').closest('li')).toHaveTextContent('✅');
    expect(screen.getByText('选视频').closest('li')).toHaveTextContent('▶️');
    expect(screen.getByText('发作品').closest('li')).toHaveTextContent('⬜');
    expect(screen.getByRole('img', { name: /实时画面/ })).toHaveAttribute('src', '/api/workers/a1/live');
    expect(screen.getByText(/adb_unreachable/)).toBeInTheDocument();
  });
  it('历史：失败行显示 第N步·error_code·foreground_pkg·diag_line + 失败截图，完成行显示完成截图，均带耗时', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({
      current: null, steps: [], frame_age_ms: null,
      history: [
        { id: 'h1', title: '失败的任务', status: 'failed', steps_total: 5, started_at: 'x', finished_at: 'y', failed_step: 3, error_code: 'adb_unreachable',
          duration_ms: 65000, evidence_screenshot_url: null,
          failed_scene: { foreground_pkg: 'com.ss.android.ugc.aweme', diag_line: 'searchBtnFound=false', screenshot_ref: 't/h1/3.jpg', screenshot_url: '/api/workers/shots/t/h1/3.jpg' } },
        { id: 'h2', title: '完成的任务', status: 'completed', steps_total: 3, started_at: 'x', finished_at: 'y', failed_step: null, error_code: null,
          duration_ms: 12000, evidence_screenshot_url: '/api/workers/shots/t/h2/9999.jpg', failed_scene: null },
      ],
    });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('失败的任务')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: '耗时' })).toBeInTheDocument();
    const failedRow = screen.getByText('失败的任务').closest('tr')!;
    expect(failedRow).toHaveTextContent('第 4 步 · adb_unreachable · com.ss.android.ugc.aweme · searchBtnFound=false');
    expect(failedRow).toHaveTextContent('1分05秒');
    const failShot = failedRow.querySelector('img')!;
    expect(failShot).toHaveAttribute('src', '/api/workers/shots/t/h1/3.jpg');
    expect(failShot.closest('a')).toHaveAttribute('href', '/api/workers/shots/t/h1/3.jpg');
    const doneRow = screen.getByText('完成的任务').closest('tr')!;
    expect(doneRow).toHaveTextContent('12秒');
    const doneShot = doneRow.querySelector('img')!;
    expect(doneShot).toHaveAttribute('src', '/api/workers/shots/t/h2/9999.jpg');
    expect(doneShot.closest('a')).toHaveAttribute('href', '/api/workers/shots/t/h2/9999.jpg');
  });
  it('frame_age_ms 超过 15 秒显示"画面不可用"（后端下发帧龄，不再靠 <img> onLoad 计时——Chrome 对 MJPEG 只在首帧触发一次 load）', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({ current: null, steps: [], history: [], frame_age_ms: 20_000 });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('空闲')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('画面不可用')).toBeInTheDocument());
  });
  it('frame_age_ms 未超过 15 秒不显示"画面不可用"', async () => {
    (fetchWorkerActivity as any).mockResolvedValue({ current: null, steps: [], history: [], frame_age_ms: 500 });
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('空闲')).toBeInTheDocument());
    expect(screen.queryByText('画面不可用')).not.toBeInTheDocument();
  });
  it('fetchWorkerActivity 失败（含 404）时显示错误态，不再吞错', async () => {
    (fetchWorkerActivity as any).mockRejectedValue(new Error('HTTP 404'));
    renderAt('a1');
    await waitFor(() => expect(screen.getByText('无法加载该工作机（可能不存在或无权限）')).toBeInTheDocument());
  });
});
