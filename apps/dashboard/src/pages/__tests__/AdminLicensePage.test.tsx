/**
 * Sprint A · WS3 — Dashboard super-admin 后台 /admin/license
 *
 * BEHAVIOR 覆盖（合同 sprints/sprint-a-license-ui/contract-dod-ws3.md）:
 *  - AdminLicensePage super-admin 渲染创建表单 + 列表
 *  - AdminLicensePage 非 super-admin 不渲染表单（显示 403 或重定向标识）
 *  - AdminLicensePage 提交创建表单调用 createLicense API 一次
 *  - AdminLicensePage 点击吊销按钮 + 确认调用 revokeLicense API 一次
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminLicensePage from '../AdminLicensePage';
import * as licenseApi from '../../api/license.api';

vi.mock('../../api/license.api', () => ({
  fetchMyLicense: vi.fn(),
  listAllLicenses: vi.fn(),
  createLicense: vi.fn(),
  revokeLicense: vi.fn(),
}));

// 模拟 AuthContext，使 isSuperAdmin 可控
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

const LICENSE_FIXTURE = {
  id: '11111111-1111-1111-1111-111111111111',
  license_key: 'ZJ-M-ABCD1234',
  tier: 'matrix' as const,
  max_machines: 3,
  customer_id: 'ou_alice',
  customer_name: 'Alice',
  customer_email: 'alice@example.com',
  status: 'active' as const,
  issued_at: '2026-04-28T00:00:00Z',
  expires_at: '2027-04-28T00:00:00Z',
  revoked_at: null,
  notes: null,
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AdminLicensePage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.isSuperAdmin = true;
    vi.mocked(licenseApi.listAllLicenses).mockResolvedValue({
      licenses: [LICENSE_FIXTURE],
    });
    vi.mocked(licenseApi.createLicense).mockResolvedValue({
      license_key: 'ZJ-B-NEW00001',
      ...LICENSE_FIXTURE,
    });
    vi.mocked(licenseApi.revokeLicense).mockResolvedValue({
      ...LICENSE_FIXTURE,
      status: 'revoked',
    });
  });

  it('AdminLicensePage super-admin 渲染创建表单 + 列表', async () => {
    mockAuth.isSuperAdmin = true;

    render(<AdminLicensePage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /创建/ })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/Alice/)).toBeInTheDocument();
    });
  });

  it('AdminLicensePage 非 super-admin 不渲染表单（显示 403 或重定向标识）', async () => {
    mockAuth.isSuperAdmin = false;

    render(<AdminLicensePage />, { wrapper: createWrapper() });

    // 不应该看到创建按钮
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /创建/ })).not.toBeInTheDocument();
    });

    // 应显示 403 或权限不足提示
    expect(screen.getByText(/403|权限不足|无权限/)).toBeInTheDocument();
  });

  it('AdminLicensePage 提交创建表单调用 createLicense API 一次', async () => {
    mockAuth.isSuperAdmin = true;

    render(<AdminLicensePage />, { wrapper: createWrapper() });

    const tierSelect = await screen.findByLabelText(/套餐|Tier/);
    fireEvent.change(tierSelect, { target: { value: 'basic' } });

    const emailInput = screen.getByLabelText(/邮箱|Email/);
    fireEvent.change(emailInput, { target: { value: 'newuser@example.com' } });

    const submitBtn = screen.getByRole('button', { name: /创建/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(licenseApi.createLicense).toHaveBeenCalledTimes(1);
    });
  });

  it('AdminLicensePage 点击吊销按钮 + 确认调用 revokeLicense API 一次', async () => {
    mockAuth.isSuperAdmin = true;

    // 模拟 confirm dialog 返回 true
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminLicensePage />, { wrapper: createWrapper() });

    const revokeBtn = await screen.findByRole('button', { name: /吊销/ });
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(licenseApi.revokeLicense).toHaveBeenCalledTimes(1);
    });
    expect(licenseApi.revokeLicense).toHaveBeenCalledWith(LICENSE_FIXTURE.id);
  });
});
