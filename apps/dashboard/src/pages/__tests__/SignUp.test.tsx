/**
 * PR-3 — Dashboard 邮箱+密码注册页面测试
 *
 * 覆盖：
 *  - 渲染注册表单（邮箱 / 密码 / 姓名 / license_key 字段 + 提交按钮）
 *  - 提交成功 → 跳转到首页
 *  - 提交失败 → 显示错误信息
 *  - 输入校验：缺少必填字段时不提交
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SignUp from '../SignUp';
import * as betterAuthApi from '../../api/better-auth.api';

vi.mock('../../api/better-auth.api', () => ({
  signUpEmail: vi.fn(),
  signInEmail: vi.fn(),
  getSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  signOut: vi.fn(),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const loginMock = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    login: loginMock,
    logout: vi.fn(),
    isAuthenticated: false,
    isSuperAdmin: false,
    authLoading: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SignUp />
    </MemoryRouter>
  );
}

describe('SignUp [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染注册表单：邮箱/密码/姓名/license_key 字段 + 提交按钮', () => {
    renderPage();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^密码/)).toBeInTheDocument();
    expect(screen.getByLabelText(/姓名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/license/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /注册|创建账号/ })).toBeInTheDocument();
  });

  it('提交成功 → 调用 signUpEmail 并跳转到首页', async () => {
    vi.mocked(betterAuthApi.signUpEmail).mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
      token: 'tok',
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText(/^密码/), {
      target: { value: 'Password123' },
    });
    fireEvent.change(screen.getByLabelText(/姓名/), {
      target: { value: 'Alice' },
    });

    fireEvent.click(screen.getByRole('button', { name: /注册|创建账号/ }));

    await waitFor(() => {
      expect(betterAuthApi.signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          password: 'Password123',
          name: 'Alice',
        })
      );
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/');
    });
  });

  it('提交失败 → 显示错误信息', async () => {
    vi.mocked(betterAuthApi.signUpEmail).mockRejectedValue(
      new Error('USER_ALREADY_EXISTS: 该邮箱已注册')
    );

    renderPage();

    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText(/^密码/), {
      target: { value: 'Password123' },
    });
    fireEvent.change(screen.getByLabelText(/姓名/), {
      target: { value: 'Alice' },
    });

    fireEvent.click(screen.getByRole('button', { name: /注册|创建账号/ }));

    await waitFor(() => {
      expect(screen.getByText(/该邮箱已注册|USER_ALREADY_EXISTS/)).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalledWith('/');
  });

  it('输入校验：邮箱或密码为空时不调用 signUpEmail', () => {
    renderPage();

    // 只填姓名，邮箱密码空
    fireEvent.change(screen.getByLabelText(/姓名/), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /注册|创建账号/ }));

    expect(betterAuthApi.signUpEmail).not.toHaveBeenCalled();
  });
});
