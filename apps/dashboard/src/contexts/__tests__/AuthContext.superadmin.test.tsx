/**
 * Regression test: isSuperAdmin 只走 VITE_SUPER_ADMIN_EMAILS，不再依赖 VITE_SUPER_ADMIN_FEISHU_IDS
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../AuthContext';
import * as betterAuthApi from '../../api/better-auth.api';

vi.mock('../../api/better-auth.api', () => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

function SuperAdminStatus() {
  const { isSuperAdmin, authLoading } = useAuth();
  if (authLoading) return <div>loading</div>;
  return <div data-testid="status">{isSuperAdmin ? 'super' : 'normal'}</div>;
}

describe('isSuperAdmin — 邮箱白名单', () => {
  const origSuperAdminEmails = import.meta.env.VITE_SUPER_ADMIN_EMAILS;
  const origSuperAdminFeishuIds = import.meta.env.VITE_SUPER_ADMIN_FEISHU_IDS;

  beforeEach(() => {
    vi.mocked(betterAuthApi.getSession).mockResolvedValue({
      user: { id: 'u1', name: 'Test User', email: 'admin@example.com' },
      session: { id: 's1' },
    } as any);
  });

  afterEach(() => {
    import.meta.env.VITE_SUPER_ADMIN_EMAILS = origSuperAdminEmails;
    import.meta.env.VITE_SUPER_ADMIN_FEISHU_IDS = origSuperAdminFeishuIds;
    vi.clearAllMocks();
  });

  it('邮箱在 VITE_SUPER_ADMIN_EMAILS 白名单时 isSuperAdmin=true', async () => {
    import.meta.env.VITE_SUPER_ADMIN_EMAILS = 'admin@example.com,other@example.com';
    import.meta.env.VITE_SUPER_ADMIN_FEISHU_IDS = '';

    render(
      <MemoryRouter>
        <AuthProvider>
          <SuperAdminStatus />
        </AuthProvider>
      </MemoryRouter>
    );

    await screen.findByText('super');
    expect(screen.getByTestId('status').textContent).toBe('super');
  });

  it('邮箱不在白名单时 isSuperAdmin=false', async () => {
    import.meta.env.VITE_SUPER_ADMIN_EMAILS = 'other@example.com';
    import.meta.env.VITE_SUPER_ADMIN_FEISHU_IDS = '';

    render(
      <MemoryRouter>
        <AuthProvider>
          <SuperAdminStatus />
        </AuthProvider>
      </MemoryRouter>
    );

    await screen.findByText('normal');
    expect(screen.getByTestId('status').textContent).toBe('normal');
  });

  it('VITE_SUPER_ADMIN_FEISHU_IDS 设置不影响结果（飞书分支已移除）', async () => {
    import.meta.env.VITE_SUPER_ADMIN_EMAILS = 'admin@example.com';
    import.meta.env.VITE_SUPER_ADMIN_FEISHU_IDS = 'some-feishu-id-that-should-not-matter';

    render(
      <MemoryRouter>
        <AuthProvider>
          <SuperAdminStatus />
        </AuthProvider>
      </MemoryRouter>
    );

    await screen.findByText('super');
    expect(screen.getByTestId('status').textContent).toBe('super');
  });
});
