/**
 * Walking Skeleton #1 — Agent 下载页 BEHAVIOR
 * 路由：/dashboard/agent
 *
 * 覆盖：
 *  - 渲染下载链接（GitHub Release URL placeholder）
 *  - 渲染"敬请期待"提示（first cut 还没有 release）
 *  - 渲染"已连接 Agent" 状态徽标（依赖 GET /api/agent/status）
 *  - last_heartbeat_at < 60s → 显示"已连接"绿色
 *  - last_heartbeat_at > 60s 或 null → 显示"未连接"灰色
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentDownloadPage from '../AgentDownloadPage';
import * as ws1Api from '../../api/walking-skeleton-1.api';

vi.mock('../../api/walking-skeleton-1.api', () => ({
  getAgentStatus: vi.fn(),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AgentDownloadPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染下载入口（GitHub Release placeholder + 敬请期待）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    expect(screen.getByText(/下载.*Agent|Agent.*下载/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/敬请期待|github\.com.*releases/i)).toBeInTheDocument();
    });
  });

  it('agent 已连接 → 状态显示"已连接"', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: true,
      agent_id: 'agent-uuid-1',
      hostname: 'mac-mini-01',
      version: '0.1.0',
      last_heartbeat_at: new Date().toISOString(),
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/已连接/)).toBeInTheDocument();
    });
    expect(screen.getByText(/mac-mini-01/)).toBeInTheDocument();
  });

  it('agent 离线 → 状态显示"未连接"', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/未连接/)).toBeInTheDocument();
    });
  });
});
