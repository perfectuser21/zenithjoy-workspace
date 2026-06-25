/**
 * CustomerListPage（整合后）BEHAVIOR 覆盖：
 *  - 所有 CRM 请求走 adminFetch（注入 X-User-Email；修 403）并带 ?cs_wechat_id=X（决策5）
 *  - 顶部客服机下拉：数据源 /api/wechat/cs/machines，默认选第一台已配机器
 *  - 「立即扫好友」按钮 → adminFetch POST /api/crm/friend-scan/trigger，带 {cs_wechat_id}，回显提示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CustomerListPage from '../CustomerListPage';
import { adminFetch } from '../../lib/admin-fetch';

vi.mock('../../lib/admin-fetch', () => ({
  adminFetch: vi.fn(),
}));

const mockAuth = vi.hoisted(() => ({
  isSuperAdmin: true,
  user: { id: 'ou_admin', name: 'Admin', email: 'boss@zenjoymedia.media' },
  token: 'tok',
  isAuthenticated: true,
  authLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const CS_WID = 'cs-zhang';

// /api/wechat/cs/machines 走原生 fetch（非 adminFetch），单独 mock 全局 fetch
function mockMachinesFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        machines: [
          { machine_id: 'm-1', hostname: 'PC-ZHANG', wechat_id: CS_WID, self_name: '小张', configured: true, online: true },
          { machine_id: 'm-2', hostname: 'PC-NEW', configured: false, online: false }, // 未配，下拉应过滤掉
        ],
      }),
  }) as unknown as typeof fetch;
}

// adminFetch 按 URL 分流：customers / onboarding / trigger
function mockAdminFetchRouting() {
  vi.mocked(adminFetch).mockImplementation((url: string) => {
    if (url.startsWith('/api/crm/customers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            customers: [
              { name: '客户甲', contact: '客户甲', wechat_id: null, status: 'A1', last_contact_at: null, managed: true },
            ],
            total: 1,
            cs_wechat_id: CS_WID,
          }),
      } as Response);
    }
    if (url.startsWith('/api/crm/onboarding/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            step_o1_online: 'ok',
            step_o2_scanned: 'ok',
            scanned_count: 1,
            step_o3_roster: 'ok',
            blacklist_count: 0,
            step_o4_realpublish: 'pending',
            step_o5_replied: 'pending',
          }),
      } as Response);
    }
    if (url.startsWith('/api/crm/friend-scan/trigger')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, requested_at: '2026-06-25T00:00:00Z' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMachinesFetch();
  mockAdminFetchRouting();
});

describe('CustomerListPage [整合 BEHAVIOR]', () => {
  it('客服机下拉默认选第一台已配机器，且过滤掉未配机器', async () => {
    render(<CustomerListPage />);
    const select = (await screen.findByTestId('crm-cs-machine-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(CS_WID));
    // 只有 1 个已配机器选项（m-2 未配被过滤）
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain('小张');
  });

  it('客户名册请求走 adminFetch 并带 ?cs_wechat_id=X（决策5 + 注入 X-User-Email 修 403）', async () => {
    render(<CustomerListPage />);
    await screen.findByText('客户甲');
    const customersCall = vi
      .mocked(adminFetch)
      .mock.calls.find((c) => (c[0] as string).startsWith('/api/crm/customers'));
    expect(customersCall).toBeDefined();
    expect(customersCall![0]).toContain(`cs_wechat_id=${CS_WID}`);
    // adminFetch 第二参 = email（注入 X-User-Email）
    expect(customersCall![1]).toBe('boss@zenjoymedia.media');
  });

  it('点「立即扫好友」→ adminFetch POST /friend-scan/trigger 带 {cs_wechat_id}，回显提示', async () => {
    render(<CustomerListPage />);
    const btn = await screen.findByTestId('crm-force-scan-btn');
    fireEvent.click(btn);
    await waitFor(() => {
      const call = vi
        .mocked(adminFetch)
        .mock.calls.find((c) => (c[0] as string).startsWith('/api/crm/friend-scan/trigger'));
      expect(call).toBeDefined();
      expect(call![2]?.method).toBe('POST');
      expect(JSON.parse(call![2]?.body as string)).toEqual({ cs_wechat_id: CS_WID });
    });
    await screen.findByText(/已通知客服机/);
  });
});
