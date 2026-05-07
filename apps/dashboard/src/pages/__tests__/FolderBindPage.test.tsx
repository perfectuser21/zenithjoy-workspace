/**
 * Walking Skeleton #1 — 文件夹绑定页 BEHAVIOR
 * 路由：/dashboard/folder
 *
 * 覆盖：
 *  - 渲染本地路径输入框 + 提交按钮
 *  - 提交 → 调 postFolderBind({ agent_id, local_path })
 *  - 提交成功后显示"已绑定 <path>"
 *  - agent 离线 → 按钮禁用
 *  - 空 path → 不提交
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FolderBindPage from '../FolderBindPage';
import * as ws1Api from '../../api/walking-skeleton-1.api';

vi.mock('../../api/walking-skeleton-1.api', () => ({
  getAgentStatus: vi.fn(),
  postFolderBind: vi.fn(),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const ONLINE_AGENT = {
  connected: true,
  agent_id: 'agent-1',
  hostname: 'mac-mini-01',
  version: '0.1.0',
  last_heartbeat_at: new Date().toISOString(),
};

describe('FolderBindPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ws1Api.postFolderBind).mockResolvedValue({ ok: true });
  });

  it('渲染路径输入框 + 提交按钮', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    render(<FolderBindPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByLabelText(/本地路径|文件夹/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /绑定|提交/ })).toBeInTheDocument();
  });

  it('填路径 + 提交 → 调用 postFolderBind', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    render(<FolderBindPage />, { wrapper: createWrapper() });

    const input = await screen.findByLabelText(/本地路径|文件夹/);
    fireEvent.change(input, { target: { value: '/Users/foo/my-videos' } });
    fireEvent.click(screen.getByRole('button', { name: /绑定|提交/ }));

    await waitFor(() => {
      expect(ws1Api.postFolderBind).toHaveBeenCalledTimes(1);
    });
    expect(ws1Api.postFolderBind).toHaveBeenCalledWith({
      agent_id: 'agent-1',
      local_path: '/Users/foo/my-videos',
    });
  });

  it('提交成功后显示已绑定 path', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    render(<FolderBindPage />, { wrapper: createWrapper() });

    const input = await screen.findByLabelText(/本地路径|文件夹/);
    fireEvent.change(input, { target: { value: '/Users/foo/videos' } });
    fireEvent.click(screen.getByRole('button', { name: /绑定|提交/ }));

    await waitFor(() => {
      expect(screen.getByText(/已绑定.*\/Users\/foo\/videos|绑定成功/)).toBeInTheDocument();
    });
  });

  it('空 path → 不调用 postFolderBind', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    render(<FolderBindPage />, { wrapper: createWrapper() });

    const submit = await screen.findByRole('button', { name: /绑定|提交/ });
    fireEvent.click(submit);

    // 等一拍，确保不会触发
    await new Promise((r) => setTimeout(r, 50));
    expect(ws1Api.postFolderBind).not.toHaveBeenCalled();
  });

  it('agent 离线 → 提交按钮禁用', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<FolderBindPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /绑定|提交/ })).toBeDisabled();
    });
  });
});
