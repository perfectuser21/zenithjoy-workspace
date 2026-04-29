/**
 * PR-3 — Dashboard 邮箱+密码登录页面测试
 *
 * 覆盖：
 *  - 渲染登录表单（邮箱 / 密码 + 提交按钮 + 注册/忘记密码/飞书登录链接）
 *  - 提交成功 → login() + 跳转到首页
 *  - 提交失败（401）→ 显示"邮箱或密码错误"
 *  - 输入校验：缺少邮箱/密码不提交
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SignIn from '../SignIn';
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
      <SignIn />
    </MemoryRouter>
  );
}

describe('SignIn [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染登录表单 + 注册/忘记密码/飞书登录三个链接', () => {
    renderPage();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument();
    // 注册链接
    expect(screen.getByRole('link', { name: /注册|创建账号/ })).toBeInTheDocument();
    // 忘记密码链接
    expect(screen.getByRole('link', { name: /忘记密码/ })).toBeInTheDocument();
    // 内部员工飞书登录入口
    expect(screen.getByRole('link', { name: /飞书|内部员工/ })).toBeInTheDocument();
  });

  it('提交成功 → 调用 signInEmail + login() + 跳转到首页', async () => {
    vi.mocked(betterAuthApi.signInEmail).mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
      token: 'tok',
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText(/密码/), {
      target: { value: 'Password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(betterAuthApi.signInEmail).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'Password123',
      });
    });
    await waitFor(() => {
      expect(loginMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/');
    });
  });

  it('提交失败 → 显示错误信息', async () => {
    vi.mocked(betterAuthApi.signInEmail).mockRejectedValue(
      new Error('INVALID_EMAIL_OR_PASSWORD: 邮箱或密码错误')
    );

    renderPage();

    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText(/密码/), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /登录/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/邮箱或密码错误|INVALID_EMAIL_OR_PASSWORD/)
      ).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalledWith('/');
  });

  it('输入校验：邮箱或密码为空时不调用 signInEmail', () => {
    renderPage();

    // 只输入邮箱，密码为空
    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /登录/ }));

    expect(betterAuthApi.signInEmail).not.toHaveBeenCalled();
  });
});
