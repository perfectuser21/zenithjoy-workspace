import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcquisitionAccountsPage, { WarmupLivenessPanel } from '../AcquisitionAccountsPage';
import AcquisitionTasksPage from '../AcquisitionTasksPage';
import LeadsPage from '../LeadsPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function response(status: number) {
  return { ok: false, status, json: async () => ({ success: false, error: { code: 'FIXTURE', message: 'fixture error' } }) } as Response;
}
for (const status of [401, 503]) {
  it(`账号历史 HTTP ${status} 不伪称无记录`, async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status)));
    render(<AcquisitionAccountsPage />);
    expect(await screen.findByText(/账号历史读取失败/)).toBeTruthy();
    expect(screen.queryByText('暂无历史小号')).toBeNull();
  });
  it(`验活历史 HTTP ${status} 不隐藏错误`, async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status)));
    render(<WarmupLivenessPanel agentId="fixture" />);
    expect(await screen.findByText(/验活历史读取失败/)).toBeTruthy();
  });
}
it('验活历史网络失败明确显示，真实空结果不显示错误', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { liveness: [] } }) });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<WarmupLivenessPanel agentId="offline" />);
  expect(await screen.findByText(/验活历史读取失败/)).toBeTruthy();
  view.unmount();
  const empty = render(<WarmupLivenessPanel agentId="empty" />);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(empty.queryByText(/验活历史读取失败/)).toBeNull();
});
it('任务列表请求失败不伪称暂无历史', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(503)));
  render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);
  expect(await screen.findByText('fixture error')).toBeTruthy();
  expect(screen.queryByText('暂无历史任务')).toBeNull();
});
it('任务详情请求失败不伪称正在采集', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(503)));
  render(<MemoryRouter initialEntries={['/area/acquisition/tasks/id']}><Routes><Route path="/area/acquisition/tasks/:taskId" element={<AcquisitionTasksPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('fixture error')).toBeTruthy();
  expect(screen.queryByText(/采集中，稍后刷新查看视频结果/)).toBeNull();
});
it('历史线索查询失败不显示0条或空表', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(503)));
  render(<LeadsPage />);
  expect(await screen.findByText(/HTTP 503/)).toBeTruthy();
  expect(screen.queryByText('共 0 条')).toBeNull();
});
