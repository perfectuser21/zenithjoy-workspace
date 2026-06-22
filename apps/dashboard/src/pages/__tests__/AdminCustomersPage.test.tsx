/**
 * AdminCustomersPage（合并后的唯一「客户管理」页）
 *
 * BEHAVIOR 覆盖：
 *  - 公司表格渲染 name / License / 成员数（member_count）
 *  - 选中一行公司 → 加载该公司成员/绑定
 *  - ① 成员区：列出成员（email + role）/ 按 email 拉人 / 移除成员
 *  - ② 客服-PC 绑定区：把成员绑到机器
 *  - 非 super-admin → 403
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminCustomersPage from '../AdminCustomersPage';
import * as customerAdminApi from '../../api/customer-admin.api';
import * as moduleHealthApi from '../../api/moduleHealth.api';
import { adminFetch } from '../../lib/admin-fetch';

vi.mock('../../lib/admin-fetch', () => ({
  adminFetch: vi.fn(),
}));

vi.mock('../../api/customer-admin.api', () => ({
  updateCompanyName: vi.fn(),
  listMembers: vi.fn(),
  addMemberByEmail: vi.fn(),
  removeMember: vi.fn(),
  listServiceAgents: vi.fn(),
  bindDevice: vi.fn(),
  deleteBinding: vi.fn(),
}));

vi.mock('../../api/moduleHealth.api', () => ({
  fetchModuleHealth: vi.fn(),
}));

const mockAuth = vi.hoisted(() => ({
  isSuperAdmin: true,
  user: { id: 'ou_admin', name: 'Admin', email: 'admin@x.com' },
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

const TID = '11111111-1111-1111-1111-111111111111';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.isSuperAdmin = true;
  vi.mocked(adminFetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success: true,
        total: 1,
        data: [
          { tenant_id: TID, email: 'a@b.com', name: '晨悦传媒', member_count: 2, license_status: 'pro' },
        ],
      }),
  } as Response);
  vi.mocked(customerAdminApi.listMembers).mockResolvedValue({
    success: true,
    total: 2,
    data: [
      { user_id: 'usr-1', email: 'alice@t.test', name: 'Alice', role: 'owner', joined_at: '2026-06-22' },
      { user_id: 'usr-2', email: 'svc@t.test', name: '客服', role: 'member', joined_at: '2026-06-22' },
    ],
  });
  vi.mocked(customerAdminApi.listServiceAgents).mockResolvedValue({
    success: true,
    total: 0,
    data: [],
  });
  vi.mocked(customerAdminApi.addMemberByEmail).mockResolvedValue({
    user_id: 'usr-9',
    email: 'new@t.test',
    role: 'member',
  });
  vi.mocked(customerAdminApi.removeMember).mockResolvedValue(undefined as unknown as void);
  vi.mocked(customerAdminApi.bindDevice).mockResolvedValue({ binding_id: 'b1' });
  vi.mocked(customerAdminApi.updateCompanyName).mockResolvedValue({ tenant_id: TID, name: '晨悦传媒' });
  vi.mocked(moduleHealthApi.fetchModuleHealth).mockResolvedValue({ ok: true, data: [] });
});

describe('AdminCustomersPage [BEHAVIOR]', () => {
  it('非 super-admin → 403', async () => {
    mockAuth.isSuperAdmin = false;
    render(<AdminCustomersPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/403|权限不足/)).toBeInTheDocument();
    });
  });

  it('公司表格渲染 name 与成员数 member_count', async () => {
    render(<AdminCustomersPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('晨悦传媒')).toBeInTheDocument();
    });
    // 成员数列展示 2
    const row = screen.getByTestId('company-row');
    expect(row).toHaveTextContent('2');
  });

  it('选中公司后 ① 成员区列出成员（email + role）', async () => {
    render(<AdminCustomersPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(2);
    });
    const rows = screen.getAllByTestId('member-row');
    expect(rows[0]).toHaveTextContent('alice@t.test');
    expect(rows[1]).toHaveTextContent('svc@t.test');
    expect(screen.getByTestId('region-members')).toBeInTheDocument();
  });

  it('按 email 拉成员进公司 → 调 addMemberByEmail', async () => {
    render(<AdminCustomersPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('member-email-input')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('member-email-input'), { target: { value: 'new@t.test' } });
    fireEvent.click(screen.getByTestId('member-add'));
    await waitFor(() => {
      expect(customerAdminApi.addMemberByEmail).toHaveBeenCalledTimes(1);
    });
    expect(customerAdminApi.addMemberByEmail).toHaveBeenCalledWith(TID, 'new@t.test', expect.any(String), 'admin@x.com');
  });

  it('移除成员 → 调 removeMember', async () => {
    render(<AdminCustomersPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(2);
    });
    const removeBtns = await screen.findAllByTestId('member-remove');
    fireEvent.click(removeBtns[0]);
    await waitFor(() => {
      expect(customerAdminApi.removeMember).toHaveBeenCalledTimes(1);
    });
    expect(customerAdminApi.removeMember).toHaveBeenCalledWith(TID, 'usr-1', 'admin@x.com');
  });

  it('② 绑定区把成员绑到机器 → 调 bindDevice', async () => {
    render(<AdminCustomersPage />, { wrapper: createWrapper() });
    // 等成员加载完（绑定下拉的选项来自成员列表）
    await waitFor(() => {
      expect(screen.getAllByTestId('member-row')).toHaveLength(2);
    });
    fireEvent.change(screen.getByTestId('bind-member-select'), { target: { value: 'usr-2' } });
    fireEvent.change(screen.getByTestId('bind-machine-input'), { target: { value: 'pc-1' } });
    fireEvent.click(screen.getByTestId('bind-submit'));
    await waitFor(() => {
      expect(customerAdminApi.bindDevice).toHaveBeenCalledTimes(1);
    });
    expect(customerAdminApi.bindDevice).toHaveBeenCalledWith(TID, 'usr-2', 'pc-1', 'admin@x.com');
  });
});
