/**
 * Walking Skeleton #1 — Agent 下载页 BEHAVIOR
 * 路由：/dashboard/agent
 *
 * 覆盖：
 *  - 渲染真实下载链接（指向 /download/zenithjoy-agent-v0.1.0.tar.gz）
 *  - 渲染解压后启动指引（含 customer-start.sh）
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

  it('渲染真实下载链接（指向 /download/zenithjoy-agent-v0.1.0.tar.gz）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: /Agent.*客户端/i })).toBeInTheDocument();

    // 必须有真实下载链接，不是 placeholder / 敬请期待
    const downloadLink = await screen.findByRole('link', { name: /下载.*Agent/i });
    expect(downloadLink).toHaveAttribute(
      'href',
      '/download/zenithjoy-agent-v0.1.0.tar.gz',
    );
    expect(downloadLink).toHaveAttribute('download');

    // "敬请期待" 不应再出现（已有真 release）
    expect(screen.queryByText(/敬请期待/)).not.toBeInTheDocument();
  });

  it('渲染 Windows 启动指引（主流程，含 customer-start.bat + set ZENITHJOY_LICENSE）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    // Windows 主标题
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Windows.*主流程|Windows.*启动/i }),
      ).toBeInTheDocument();
    });
    // Windows 关键命令：customer-start.bat 与 cmd 风格 set 命令
    expect(screen.getByText(/customer-start\.bat/)).toBeInTheDocument();
    expect(screen.getByText(/set ZENITHJOY_LICENSE/)).toBeInTheDocument();
    expect(screen.getAllByText(/npm install/).length).toBeGreaterThanOrEqual(1);
  });

  it('渲染 macOS 启动指引（开发者备用，含 customer-start.sh）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    // macOS 标题（带"开发者"或"备用"字样以区别于 Windows 主流程）
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /macOS.*开发者|macOS.*备用/i }),
      ).toBeInTheDocument();
    });
    // macOS 关键命令：bash + customer-start.sh
    expect(screen.getByText(/customer-start\.sh/)).toBeInTheDocument();
    expect(screen.getByText(/export ZENITHJOY_LICENSE/)).toBeInTheDocument();
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
