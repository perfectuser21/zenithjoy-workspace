/**
 * Path 4 Sprint 1 ws2 — AgentMachines 页面 BEHAVIOR 测试
 *
 * 路由：/dashboard/agent-machines（或对应 nav）
 * 内容：
 *  - agent 列表卡片，每张卡片含"绑定微信"按钮 + 通道下拉
 *  - 通道下拉：个人微信（thin）/企业微信（disabled，title="加厚阶段开放"）
 *  - 点"绑定微信" → 调 postWechatQrBind({platform:'wechat_personal', agent_id})
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentMachines from '../AgentMachines';
import * as wsApi from '../../api/walking-skeleton-1.api';
import * as wechatApi from '../../api/wechat.api';

vi.mock('../../api/walking-skeleton-1.api', () => ({
  getAgentStatus: vi.fn(),
}));

vi.mock('../../api/wechat.api', () => ({
  postWechatQrBind: vi.fn(),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
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

describe('AgentMachines [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wsApi.getAgentStatus).mockResolvedValue(ONLINE_AGENT);
    vi.mocked(wechatApi.postWechatQrBind).mockResolvedValue({
      task_id: 'task-uuid-001',
      status: 'dispatched',
    });
  });

  it('渲染"绑定微信"按钮（visible）', async () => {
    render(<AgentMachines />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /绑定微信/ })).toBeInTheDocument();
    });
  });

  it('通道下拉含"个人微信"和"企业微信"，企微 disabled', async () => {
    render(<AgentMachines />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /通道/ })).toBeInTheDocument();
    });
    const select = screen.getByRole('combobox', { name: /通道/ }) as HTMLSelectElement;
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    const personal = options.find((o) => /个人微信/.test(o.textContent || ''));
    const enterprise = options.find((o) => /企业微信/.test(o.textContent || ''));
    expect(personal).toBeDefined();
    expect(personal?.disabled).toBe(false);
    expect(enterprise).toBeDefined();
    expect(enterprise?.disabled).toBe(true);
    expect(enterprise?.title).toMatch(/加厚阶段开放/);
  });

  it('点击"绑定微信" → postWechatQrBind({platform:wechat_personal, agent_id})（happy）', async () => {
    render(<AgentMachines />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /绑定微信/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /绑定微信/ }));

    await waitFor(() => {
      expect(wechatApi.postWechatQrBind).toHaveBeenCalledTimes(1);
    });
    expect(wechatApi.postWechatQrBind).toHaveBeenCalledWith({
      platform: 'wechat_personal',
      agent_id: 'agent-1',
    });
  });
});
