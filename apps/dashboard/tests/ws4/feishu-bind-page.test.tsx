/**
 * WS4 — FeishuBindTenant.tsx Vitest 组件单测
 *
 * commit-1 RED（组件未建）；commit-2 GREEN。
 * E2E 真浏览器流程在 apps/dashboard/e2e/path-2-sprint-a.spec.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// jest-dom matchers 由 src/test/setup.ts 全局加载（dashboard 既有模式）— monorepo CI 下 jest-dom/vitest 子路径 ESM resolve 找不到 vitest，这里不重复 import

const importPage = async () =>
  await import('../../../../apps/dashboard/src/pages/FeishuBindTenant');

describe('Workstream 4 — FeishuBindTenant 页 [BEHAVIOR]', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('未绑定状态：渲染 app_id + app_secret 表单', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { bound: false } }),
    });

    const Page = (await importPage()).default;
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByLabelText(/app_id|App ID/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/app_secret|App Secret/i)).toBeInTheDocument();
    });
  });

  it('提交表单触发 fetch /api/feishu/oauth/start + 跳转 authorize_url', async () => {
    const fetchMock = global.fetch as any;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { bound: false } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { authorize_url: 'https://passport.feishu.cn/suite/passport/oauth/authorize?state=xxx' },
        }),
      });

    delete (window as any).location;
    (window as any).location = { href: '' };

    const Page = (await importPage()).default;
    render(<Page />);

    await waitFor(() => screen.getByLabelText(/app_id|App ID/i));

    fireEvent.change(screen.getByLabelText(/app_id|App ID/i), { target: { value: 'cli_xxx' } });
    fireEvent.change(screen.getByLabelText(/app_secret|App Secret/i), { target: { value: 'sec_xxx' } });
    fireEvent.click(screen.getByRole('button', { name: /开始绑定|绑定/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/feishu/oauth/start'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('已绑定状态：显示"飞书已绑定 ✓" + Bitable 链接 + "刷新状态"按钮', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          bound: true,
          app_token: 'bascn_xxx',
          bitable_url: 'https://example.feishu.cn/base/bascn_xxx',
        },
      }),
    });

    const Page = (await importPage()).default;
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText(/飞书已绑定/)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /Bitable|多维表格|查看/i }) as HTMLAnchorElement;
      expect(link.href).toMatch(/feishu\.cn\/base\//);
      expect(screen.getByRole('button', { name: /刷新状态/i })).toBeInTheDocument();
    });
  });

  it('点击"刷新状态"触发 fetch /api/lead-config/ 渲染画像 + 视频', async () => {
    const fetchMock = global.fetch as any;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { bound: true, app_token: 'a', bitable_url: 'https://x.feishu.cn/base/a' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            profile: { industry: '装修', keyword: '小户型', hook: '送装修方案 PDF' },
            target_videos: [{ url: 'https://v.douyin.com/test/', note: 'smoke' }],
          },
        }),
      });

    const Page = (await importPage()).default;
    render(<Page />);

    await waitFor(() => screen.getByRole('button', { name: /刷新状态/i }));
    fireEvent.click(screen.getByRole('button', { name: /刷新状态/i }));

    await waitFor(() => {
      expect(screen.getByText('装修')).toBeInTheDocument();
      expect(screen.getByText('小户型')).toBeInTheDocument();
      expect(screen.getByText(/送装修方案/)).toBeInTheDocument();
    });
  });
});
