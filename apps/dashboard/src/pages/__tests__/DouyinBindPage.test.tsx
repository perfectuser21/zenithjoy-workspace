/**
 * Walking Skeleton #1 — 抖音绑定页 BEHAVIOR
 * 路由：/dashboard/platforms/douyin
 *
 * 覆盖：
 *  - 渲染"扫码绑抖音"按钮 + 当前 douyin session 状态
 *  - 点击按钮 → 调 postQrBind('agent_id','douyin')
 *  - 显示 platform session status（pending|active|expired）
 *  - agent 不在线时按钮禁用，提示先下载 Agent
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DouyinBindPage from '../DouyinBindPage';
import * as ws1Api from '../../api/walking-skeleton-1.api';

vi.mock('../../api/walking-skeleton-1.api', () => ({
  getAgentStatus: vi.fn(),
  getPlatformSessions: vi.fn(),
  postQrBind: vi.fn(),
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

describe('DouyinBindPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ws1Api.postQrBind).mockResolvedValue({ ok: true });
  });

  it('渲染"扫码绑抖音"按钮 + douyin pending 状态', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.getPlatformSessions).mockResolvedValue({
      sessions: [
        { platform: 'douyin', account_label: 'default', status: 'pending', bound_at: null },
      ],
    });
    render(<DouyinBindPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /扫码绑抖音/ })).toBeInTheDocument();
    });
    expect(screen.getByText(/pending|未绑定/i)).toBeInTheDocument();
  });

  it('点击"扫码绑抖音"按钮 → 调用 postQrBind(agent_id, "douyin")', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.getPlatformSessions).mockResolvedValue({ sessions: [] });
    render(<DouyinBindPage />, { wrapper: createWrapper() });

    const btn = await screen.findByRole('button', { name: /扫码绑抖音/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(ws1Api.postQrBind).toHaveBeenCalledTimes(1);
    });
    expect(ws1Api.postQrBind).toHaveBeenCalledWith('agent-1', 'douyin');
  });

  it('agent 离线 → 按钮禁用 + 提示先下载 Agent', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    vi.mocked(ws1Api.getPlatformSessions).mockResolvedValue({ sessions: [] });

    render(<DouyinBindPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/请先下载.*Agent|Agent.*未连接|先连接 Agent/)).toBeInTheDocument();
    });
    const btn = screen.getByRole('button', { name: /扫码绑抖音/ });
    expect(btn).toBeDisabled();
  });

  it('已绑定 active session → 显示绿色"已绑定"', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(ws1Api.getPlatformSessions).mockResolvedValue({
      sessions: [
        {
          platform: 'douyin',
          account_label: 'default',
          status: 'active',
          bound_at: '2026-05-07T11:00:00Z',
        },
      ],
    });
    render(<DouyinBindPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/已绑定|active/i)).toBeInTheDocument();
    });
  });
});
