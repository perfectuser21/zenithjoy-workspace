/**
 * Walking Skeleton #1 — 一键发布 + 回执页 BEHAVIOR
 * 路由：/dashboard/publish
 *
 * 覆盖：
 *  - 渲染"发布到抖音"按钮
 *  - 点击 → 调 postPublishTask({ agent_id, platform: 'douyin', folder_path })
 *  - 渲染 publish_tasks 列表（每行：id / status / result）
 *  - 任务完成后展示回执 result.url
 *  - agent 离线 / 未绑定文件夹 → 按钮禁用
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublishPage from '../PublishPage';
import * as ws1Api from '../../api/walking-skeleton-1.api';

vi.mock('../../api/walking-skeleton-1.api', () => ({
  getAgentStatus: vi.fn(),
  postPublishTask: vi.fn(),
  getPublishTask: vi.fn(),
  listPublishTasks: vi.fn(),
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
  bound_folder_path: '/Users/foo/videos',
};

describe('PublishPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染"发布到抖音"按钮 + 任务列表', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({ tasks: [] });
    render(<PublishPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /发布到抖音/ })).toBeInTheDocument();
    });
  });

  it('点击发布 → 调用 postPublishTask 并刷新列表', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(ws1Api.postPublishTask).mockResolvedValue({
      task_id: 'task-uuid-1',
      status: 'pending',
    });
    render(<PublishPage />, { wrapper: createWrapper() });

    // 等 agent-status query 加载完，canPublish=true 后按钮才启用
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /发布到抖音/ })
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /发布到抖音/ }));

    await waitFor(() => {
      expect(ws1Api.postPublishTask).toHaveBeenCalledTimes(1);
    });
    expect(ws1Api.postPublishTask).toHaveBeenCalledWith({
      agent_id: 'agent-1',
      platform: 'douyin',
      folder_path: '/Users/foo/videos',
      type: 'image',
    });
  });

  it('选 video radio 后点发布 → postPublishTask 收 type=video（sprint 2.1c 新）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(ws1Api.postPublishTask).mockResolvedValue({
      task_id: 'task-uuid-video',
      status: 'pending',
    });
    render(<PublishPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /发布到抖音/ })
      ).not.toBeDisabled();
    });

    // 选 video radio (sprint 2.1c 新加 UI)
    const videoRadio = screen.getByLabelText(/视频/);
    fireEvent.click(videoRadio);

    fireEvent.click(screen.getByRole('button', { name: /发布到抖音/ }));

    await waitFor(() => {
      expect(ws1Api.postPublishTask).toHaveBeenCalledTimes(1);
    });
    expect(ws1Api.postPublishTask).toHaveBeenCalledWith({
      agent_id: 'agent-1',
      platform: 'douyin',
      folder_path: '/Users/foo/videos',
      type: 'video',
    });
  });

  it('显示已有 publish_tasks（success 任务展示 url）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({
      tasks: [
        {
          id: 'task-1',
          status: 'success',
          result: { url: 'https://www.douyin.com/video/abc' },
          created_at: '2026-05-07T10:00:00Z',
          receipt_at: '2026-05-07T10:01:00Z',
        },
        {
          id: 'task-2',
          status: 'running',
          result: null,
          created_at: '2026-05-07T10:02:00Z',
          receipt_at: null,
        },
      ],
    });
    render(<PublishPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/task-1/)).toBeInTheDocument();
    });
    expect(screen.getByText(/douyin\.com\/video\/abc/)).toBeInTheDocument();
    expect(screen.getByText(/running|执行中/i)).toBeInTheDocument();
  });

  it('agent 离线 → 发布按钮禁用', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
      bound_folder_path: null,
    });
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({ tasks: [] });
    render(<PublishPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /发布到抖音/ })).toBeDisabled();
    });
  });

  it('切换平台到快手 → 按钮文字变为"发布到快手"，文章选项消失', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: true,
      agent_id: 'agent-1',
      hostname: 'test-host',
      version: '1.1.32',
      last_heartbeat_at: new Date().toISOString(),
      bound_folder_path: '/videos',
    });
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({ tasks: [] });
    render(<PublishPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /发布到抖音/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('radio', { name: /快手/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /发布到快手/ })).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /文章/ })).not.toBeInTheDocument();
    });
  });

  it('快手平台点击发布 → platform=kuaishou', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: true,
      agent_id: 'agent-1',
      hostname: 'test-host',
      version: '1.1.32',
      last_heartbeat_at: new Date().toISOString(),
      bound_folder_path: '/videos',
    });
    vi.mocked(ws1Api.listPublishTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(ws1Api.postPublishTask).mockResolvedValue({ task_id: 'task-ks-1', status: 'pending' });
    render(<PublishPage />, { wrapper: createWrapper() });
    await waitFor(() => screen.getByRole('radio', { name: /快手/ }));
    fireEvent.click(screen.getByRole('radio', { name: /快手/ }));
    fireEvent.click(screen.getByRole('button', { name: /发布到快手/ }));
    await waitFor(() => {
      expect(ws1Api.postPublishTask).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'kuaishou' })
      );
    });
  });
});
