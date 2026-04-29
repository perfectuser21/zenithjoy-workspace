/**
 * PR-A — 超管会员管理页 /admin/users
 *
 * BEHAVIOR 覆盖：
 *  - super-admin 渲染：搜索框 + 用户表格
 *  - 非 super-admin 显示 403
 *  - 点击"拉进 tenant"按钮 → 弹窗 → 提交调用 addUserToTenant
 *  - 点击 tenant 标签上的 X → 确认 → 调用 removeUserFromTenant
 *  - 点击"删除用户" → 确认 → 调用 deleteUser
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminUsersPage from '../AdminUsersPage';
import * as adminUsersApi from '../../api/admin-users.api';

vi.mock('../../api/admin-users.api', () => ({
  listUsers: vi.fn(),
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  deleteUser: vi.fn(),
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

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const USERS_FIXTURE = {
  users: [
    {
      id: 'usr_001',
      email: 'alice@example.com',
      name: 'Alice',
      emailVerified: true,
      createdAt: '2026-04-28T10:00:00.000Z',
      tenants: [
        { tenant_id: TENANT_ID, name: 'Acme Inc', plan: 'pro', role: 'member' },
      ],
    },
    {
      id: 'usr_002',
      email: 'bob@example.com',
      name: 'Bob',
      emailVerified: false,
      createdAt: '2026-04-28T11:00:00.000Z',
      tenants: [],
    },
  ],
  total: 2,
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AdminUsersPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.isSuperAdmin = true;
    vi.mocked(adminUsersApi.listUsers).mockResolvedValue(USERS_FIXTURE);
    vi.mocked(adminUsersApi.addUserToTenant).mockResolvedValue({
      tenants: [
        { tenant_id: TENANT_ID, name: 'Acme Inc', plan: 'pro', role: 'admin' },
      ],
    });
    vi.mocked(adminUsersApi.removeUserFromTenant).mockResolvedValue({
      success: true,
    });
    vi.mocked(adminUsersApi.deleteUser).mockResolvedValue({ success: true });
  });

  it('super-admin 渲染：搜索框 + 用户表格', async () => {
    mockAuth.isSuperAdmin = true;
    render(<AdminUsersPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索|email/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    });
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    // tenants 标签
    expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
  });

  it('非 super-admin → 403', async () => {
    mockAuth.isSuperAdmin = false;
    render(<AdminUsersPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/403|权限不足|无权限/)).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText(/搜索|email/i)).not.toBeInTheDocument();
  });

  it('点击"拉进 tenant"按钮 → 弹窗 → 提交调用 addUserToTenant', async () => {
    mockAuth.isSuperAdmin = true;
    render(<AdminUsersPage />, { wrapper: createWrapper() });

    // 等列表渲染
    await waitFor(() => {
      expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    });

    // bob 那行应有"拉进 tenant"按钮（多个，点第一个即可）
    const buttons = await screen.findAllByRole('button', { name: /拉进/ });
    fireEvent.click(buttons[0]);

    // 弹窗里填 tenant_id 并提交
    const tenantInput = await screen.findByLabelText(/Tenant ID|租户/);
    fireEvent.change(tenantInput, { target: { value: TENANT_ID } });

    const submit = screen.getByRole('button', { name: /确认|提交|保存/ });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(adminUsersApi.addUserToTenant).toHaveBeenCalledTimes(1);
    });
  });

  it('点击 tenant 标签 X → 确认 → 调用 removeUserFromTenant', async () => {
    mockAuth.isSuperAdmin = true;
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminUsersPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
    });

    // 标签上的 X 按钮（aria-label="移除 tenant member"）
    const removeBtn = await screen.findByRole('button', { name: /移除 tenant/ });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(adminUsersApi.removeUserFromTenant).toHaveBeenCalledTimes(1);
    });
    expect(adminUsersApi.removeUserFromTenant).toHaveBeenCalledWith(
      'usr_001',
      TENANT_ID
    );
  });

  it('点击"删除用户" → 确认 → 调用 deleteUser', async () => {
    mockAuth.isSuperAdmin = true;
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminUsersPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    });

    const delBtns = await screen.findAllByRole('button', { name: /删除用户/ });
    fireEvent.click(delBtns[0]);

    await waitFor(() => {
      expect(adminUsersApi.deleteUser).toHaveBeenCalledTimes(1);
    });
    expect(adminUsersApi.deleteUser).toHaveBeenCalledWith('usr_001');
  });
});
