import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrgSwitcher from './OrgSwitcher';

// 直接 mock useAuth：本文件只验证 OrgSwitcher 自身的渲染分支与回调派发，
// 不牵扯真 AuthProvider 的异步引导（那部分在 AuthContext.test.tsx 里跑）。
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
import { useAuth } from '../contexts/AuthContext';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    orgs: [],
    currentOrgId: null,
    needsOrgSelection: false,
    switchOrg: vi.fn().mockResolvedValue(undefined),
    pendingRemoteSwitch: null,
    confirmRemoteSwitch: vi.fn(),
    dismissRemoteSwitch: vi.fn(),
    ...overrides,
  };
}

describe('OrgSwitcher', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('单企业：只显示当前企业名，不渲染切换下拉（A8 零回归）', () => {
    mockUseAuth.mockReturnValue(
      baseCtx({
        orgs: [{ org_id: 'o1', name: '甲公司', role: 'owner' }],
        currentOrgId: 'o1',
      })
    );
    render(<OrgSwitcher />);
    expect(screen.getByTestId('current-org-label')).toHaveTextContent('当前企业：甲公司');
    expect(screen.queryByTestId('org-switcher-trigger')).toBeNull();
  });

  it('≥2 家未选：渲染阻断式选择界面，列出全部候选企业', () => {
    mockUseAuth.mockReturnValue(
      baseCtx({
        orgs: [
          { org_id: 'o1', name: '甲公司', role: 'owner' },
          { org_id: 'o2', name: '乙公司', role: 'member' },
        ],
        currentOrgId: null,
        needsOrgSelection: true,
      })
    );
    render(<OrgSwitcher />);
    expect(screen.getByTestId('org-selection-required')).toBeInTheDocument();
    expect(screen.getByTestId('org-option-o1')).toBeInTheDocument();
    expect(screen.getByTestId('org-option-o2')).toBeInTheDocument();
    // 阻断态不应出现普通顶栏标识
    expect(screen.queryByTestId('current-org-label')).toBeNull();
  });

  it('多企业已选：点下拉里的另一家 → 调用 switchOrg(目标 org_id)', async () => {
    const switchOrg = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(
      baseCtx({
        orgs: [
          { org_id: 'o1', name: '甲公司', role: 'owner' },
          { org_id: 'o2', name: '乙公司', role: 'member' },
        ],
        currentOrgId: 'o1',
        switchOrg,
      })
    );
    render(<OrgSwitcher />);
    fireEvent.click(screen.getByTestId('org-switcher-trigger'));
    fireEvent.click(screen.getByTestId('org-option-o2'));
    await waitFor(() => expect(switchOrg).toHaveBeenCalledWith('o2'));
  });

  it('别的标签页切换 + 本页有草稿：弹出草稿拦截提示', () => {
    mockUseAuth.mockReturnValue(
      baseCtx({
        orgs: [
          { org_id: 'o1', name: '甲公司', role: 'owner' },
          { org_id: 'o2', name: '乙公司', role: 'member' },
        ],
        currentOrgId: 'o1',
        pendingRemoteSwitch: 'o2',
      })
    );
    render(<OrgSwitcher />);
    expect(screen.getByTestId('org-switch-draft-guard')).toBeInTheDocument();
    expect(screen.getByTestId('org-switch-draft-discard')).toBeInTheDocument();
    expect(screen.getByTestId('org-switch-draft-keep')).toBeInTheDocument();
  });
});
