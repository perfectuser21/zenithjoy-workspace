/**
 * Walking Skeleton #1 — Agent 下载页 BEHAVIOR
 * 路由：/dashboard/agent
 *
 * 覆盖：
 *  - 渲染真实下载链接（指向 /download/zenithjoy-agent-v0.1.8.tar.gz）
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
import * as accountApi from '../../api/account.api';

vi.mock('../../api/walking-skeleton-1.api', () => ({
  getAgentStatus: vi.fn(),
  getInstallPackManifest: vi.fn().mockResolvedValue({
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    download_url: '/download/zenithjoy-agent-v1.0.0.tar.gz',
    size: 22637557,
    build_time: '2026-05-09T03:01:22Z',
  }),
}));
vi.mock('../../api/account.api', () => ({
  fetchAccountMe: vi.fn(),
}));

const STATUS_OFFLINE = {
  connected: false,
  agent_id: null,
  hostname: null,
  version: null,
  last_heartbeat_at: null,
} as const;

const ACCOUNT_WITH_LICENSE = {
  user: { id: 'u1', email: 'chalex@example.com', name: 'chalex' },
  license: {
    license_key: 'ZJ-F-ABC123',
    tier: 'free' as const,
    max_machines: 1,
    expires_at: '2036-01-01T00:00:00Z',
  },
};

const ACCOUNT_WITHOUT_LICENSE = {
  user: { id: 'u1', email: 'chalex@example.com', name: 'chalex' },
  license: null,
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AgentDownloadPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：未登录 / 未拿到 license（避免 useQuery hang），具体 case 各自覆盖
    vi.mocked(accountApi.fetchAccountMe).mockResolvedValue(ACCOUNT_WITHOUT_LICENSE);
  });

  it('渲染真实下载链接（指向 /download/zenithjoy-agent-v0.1.8.tar.gz）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue({
      connected: false,
      agent_id: null,
      hostname: null,
      version: null,
      last_heartbeat_at: null,
    });
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: /Agent.*客户端/i })).toBeInTheDocument();

    // Sprint 2.1e: 真实下载链接走 endpoint redirect (302 → nginx 静态)
    const downloadLink = await screen.findByRole('link', { name: /下载.*Agent/i });
    expect(downloadLink).toHaveAttribute('href', '/api/agent/install-pack/download');
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

  it('已登录 + 有 license → 命令片段嵌入真 license_key（不再是占位）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(STATUS_OFFLINE);
    vi.mocked(accountApi.fetchAccountMe).mockResolvedValue(ACCOUNT_WITH_LICENSE);
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    // 显示真 license（在 my-license 区域 + 嵌入命令）
    await waitFor(() => {
      expect(screen.getAllByText(/ZJ-F-ABC123/).length).toBeGreaterThanOrEqual(1);
    });
    // 占位字符串不应再单独出现
    expect(screen.queryByText(/ZJ-F-XXXXXX/)).not.toBeInTheDocument();
  });

  it('已登录 + 无 license → 显示占位 + 提示注册', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(STATUS_OFFLINE);
    vi.mocked(accountApi.fetchAccountMe).mockResolvedValue(ACCOUNT_WITHOUT_LICENSE);
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    // 命令片段中出现占位 ZJ-F-XXXXXX（让客户清晰知道要去哪拿）
    await waitFor(() => {
      expect(screen.getAllByText(/ZJ-F-XXXXXX/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('渲染 install-and-start.bat 双击启动指引（thin 极限的 1-click）', async () => {
    vi.mocked(ws1Api.getAgentStatus).mockResolvedValue(STATUS_OFFLINE);
    render(<AgentDownloadPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/install-and-start\.bat/)).toBeInTheDocument();
    });
    // 双击 / 一键 / 双击启动 等关键提示词其一应出现
    expect(
      screen.queryAllByText(/双击|一键|双击启动/).length,
    ).toBeGreaterThanOrEqual(1);
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
