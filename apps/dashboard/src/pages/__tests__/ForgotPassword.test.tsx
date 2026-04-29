/**
 * PR-3 — Dashboard 忘记密码页面测试
 *
 * 覆盖：
 *  - 渲染忘记密码表单（邮箱 + 提交按钮）
 *  - 提交成功 → 显示"如果邮箱存在，你会收到重置链接"（不暴露存在性）
 *  - 提交失败 → 显示错误信息
 *  - 输入校验：邮箱为空时不调用 API
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from '../ForgotPassword';
import * as betterAuthApi from '../../api/better-auth.api';

vi.mock('../../api/better-auth.api', () => ({
  signUpEmail: vi.fn(),
  signInEmail: vi.fn(),
  getSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  signOut: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>
  );
}

describe('ForgotPassword [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染忘记密码表单 + 邮箱字段 + 提交按钮 + 返回登录链接', () => {
    renderPage();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /发送重置链接|提交/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /返回登录|去登录/ })).toBeInTheDocument();
  });

  it('提交成功 → 显示"如果邮箱存在，你会收到重置链接"提示（不暴露存在性）', async () => {
    vi.mocked(betterAuthApi.requestPasswordReset).mockResolvedValue({
      status: true,
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送重置链接|提交/ }));

    await waitFor(() => {
      expect(betterAuthApi.requestPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          redirectTo: expect.stringContaining('/reset-password'),
        })
      );
    });
    await waitFor(() => {
      // 不暴露邮箱是否存在 — 始终显示"如果邮箱存在"模糊提示
      expect(
        screen.getByText(/如果.*邮箱存在|你会收到/)
      ).toBeInTheDocument();
    });
  });

  it('提交失败 → 显示错误信息', async () => {
    vi.mocked(betterAuthApi.requestPasswordReset).mockRejectedValue(
      new Error('SERVER_ERROR: 服务暂不可用')
    );

    renderPage();

    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: 'a@b.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送重置链接|提交/ }));

    await waitFor(() => {
      expect(screen.getByText(/服务暂不可用|SERVER_ERROR/)).toBeInTheDocument();
    });
  });

  it('输入校验：邮箱为空时不调用 requestPasswordReset', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /发送重置链接|提交/ }));
    expect(betterAuthApi.requestPasswordReset).not.toHaveBeenCalled();
  });
});
