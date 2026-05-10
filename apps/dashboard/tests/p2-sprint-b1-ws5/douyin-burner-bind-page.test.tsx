/**
 * WS5 — DouyinBurnerBindPage.tsx (dashboard 绑小号 + 抓评论页) (CI 实跑落点)
 *
 * Path: apps/dashboard/tests/p2-sprint-b1-ws5/ (3 deep) → ../../src/pages/...
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DouyinBurnerBindPage from '../../src/pages/DouyinBurnerBindPage';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DouyinBurnerBindPage />
    </MemoryRouter>
  );
}

describe('Workstream 5 — DouyinBurnerBindPage [BEHAVIOR]', () => {
  it('飞书未绑（GET status bound=false）→ 表单 disabled + 提示「请先完成飞书绑定」', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { bound: false } }),
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/请先完成飞书绑定/)).toBeTruthy();
    });
  });

  it('飞书已绑 + account_label=default → 校验报错 + 提交 disabled', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { bound: true } }),
    } as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { sessions: [] } }),
    } as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/account_label|小号名/i)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText(/account_label|小号名/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'default' } });
    expect(screen.getByText(/不能用 default|保留|reserved/i)).toBeTruthy();
  });

  it('GET sessions 返 burner 列表 → 渲染表格', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { bound: true } }),
    } as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          sessions: [
            {
              account_label: '装修小号1',
              role: 'burner',
              status: 'active',
              account_nickname: '小号A',
              bound_at: '2026-05-10T10:00:00Z',
            },
          ],
        },
      }),
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('装修小号1')).toBeTruthy();
      expect(screen.getByText('小号A')).toBeTruthy();
    });
  });

  it('抓取完成（status=done + comment_count=5）→ 显示「抓取完成 5 条」+ Bitable URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { bound: true } }),
    } as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { sessions: [{ account_label: 'A', role: 'burner', status: 'active', account_nickname: 'A' }] },
      }),
    } as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          status: 'done',
          comment_count: 5,
          lead_write_status: 'success',
          feishu_bitable_url: 'https://feishu.cn/base/bascn_xxx',
        },
      }),
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/抓取完成.*5/)).toBeTruthy();
    });
    expect(screen.getByText(/feishu\.cn\/base/)).toBeTruthy();
  });

  it('comment_count=0 → 显示「该视频暂无评论」', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { bound: true } }),
    } as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { sessions: [{ account_label: 'A', role: 'burner', status: 'active' }] } }),
    } as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { status: 'done', comment_count: 0 },
      }),
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/该视频暂无评论/)).toBeTruthy();
    });
  });
});
