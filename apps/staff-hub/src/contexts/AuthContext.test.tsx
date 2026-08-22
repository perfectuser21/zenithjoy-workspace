import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from './AuthContext';
import OrgSwitcher from '../components/OrgSwitcher';

// 真 AuthProvider + OrgSwitcher 一起跑，验证 org 状态机：引导填充、switch 后标识更新、needs_selection 阻断。
vi.mock('../api/betterAuth', () => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../api/orgContext', () => ({
  fetchOrgs: vi.fn(),
  switchOrg: vi.fn(),
}));

import { getSession } from '../api/betterAuth';
import { fetchOrgs, switchOrg } from '../api/orgContext';

const mockGetSession = getSession as unknown as ReturnType<typeof vi.fn>;
const mockFetchOrgs = fetchOrgs as unknown as ReturnType<typeof vi.fn>;
const mockSwitchOrg = switchOrg as unknown as ReturnType<typeof vi.fn>;

describe('AuthContext org 逻辑', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockFetchOrgs.mockReset();
    mockSwitchOrg.mockReset();
    mockGetSession.mockResolvedValue({ user: { id: 'u1', name: '张三', email: 'a@b.com' } });
  });

  it('引导：会话恢复后拉 org 上下文并填充当前企业标识', async () => {
    mockFetchOrgs.mockResolvedValue({
      orgs: [
        { org_id: 'o1', name: '甲公司', role: 'owner' },
        { org_id: 'o2', name: '乙公司', role: 'member' },
      ],
      active_org_id: 'o1',
      needs_selection: false,
    });
    render(
      <AuthProvider>
        <OrgSwitcher />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('current-org-label')).toHaveTextContent('甲公司')
    );
    expect(screen.getByTestId('org-switcher-trigger')).toBeInTheDocument();
  });

  it('切换：调用 switchOrg 后当前企业标识更新为目标企业', async () => {
    mockFetchOrgs.mockResolvedValue({
      orgs: [
        { org_id: 'o1', name: '甲公司', role: 'owner' },
        { org_id: 'o2', name: '乙公司', role: 'member' },
      ],
      active_org_id: 'o1',
      needs_selection: false,
    });
    mockSwitchOrg.mockResolvedValue({ active_org_id: 'o2' });
    render(
      <AuthProvider>
        <OrgSwitcher />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('current-org-label')).toHaveTextContent('甲公司')
    );
    fireEvent.click(screen.getByTestId('org-switcher-trigger'));
    fireEvent.click(screen.getByTestId('org-option-o2'));
    await waitFor(() => expect(mockSwitchOrg).toHaveBeenCalledWith('o2'));
    await waitFor(() =>
      expect(screen.getByTestId('current-org-label')).toHaveTextContent('乙公司')
    );
  });

  it('needs_selection=true：渲染阻断式选择界面', async () => {
    mockFetchOrgs.mockResolvedValue({
      orgs: [
        { org_id: 'o1', name: '甲公司', role: 'owner' },
        { org_id: 'o2', name: '乙公司', role: 'member' },
      ],
      active_org_id: null,
      needs_selection: true,
    });
    render(
      <AuthProvider>
        <OrgSwitcher />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('org-selection-required')).toBeInTheDocument()
    );
    expect(screen.getByTestId('org-option-o1')).toBeInTheDocument();
    expect(screen.getByTestId('org-option-o2')).toBeInTheDocument();
  });

  it('单企业：只显示当前企业名，不渲染切换下拉（A8 零回归）', async () => {
    mockFetchOrgs.mockResolvedValue({
      orgs: [{ org_id: 'o1', name: '甲公司', role: 'owner' }],
      active_org_id: 'o1',
      needs_selection: false,
    });
    render(
      <AuthProvider>
        <OrgSwitcher />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('current-org-label')).toHaveTextContent('甲公司')
    );
    expect(screen.queryByTestId('org-switcher-trigger')).toBeNull();
  });
});
