/**
 * WS5 — DouyinBurnerBindPage.tsx (dashboard 绑小号 + 抓评论页) (CI 实跑落点)
 *
 * Path: apps/dashboard/tests/p2-sprint-b1-ws5/ (3 deep) → ../../src/pages/...
 *
 * 飞书门控已移除（PR #961），不再需要飞书 status fetch。
 * fetch 顺序：① GET /api/agent/burner/sessions  ② GET /api/agent/burner/crawl-tasks/latest
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

function mockSessions(sessions: object[] = []) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { sessions } }),
  } as any);
  // crawl-tasks/latest → 404 / no data
  fetchMock.mockRejectedValueOnce(new Error('404'));
}

describe('Workstream 5 — DouyinBurnerBindPage [BEHAVIOR]', () => {
  it('account_label=default → 校验报错 + 提交 disabled', async () => {
    mockSessions([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/account_label|小号名/i)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText(/account_label|小号名/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'default' } });
    expect(screen.getByText(/不能用 default|保留|reserved/i)).toBeTruthy();
  });

  it('GET sessions 返 burner 列表 → 渲染表格', async () => {
    mockSessions([
      {
        account_label: '装修小号1',
        role: 'burner',
        status: 'active',
        account_nickname: '小号A',
        bound_at: '2026-05-10T10:00:00Z',
      },
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('装修小号1')).toBeTruthy();
      expect(screen.getByText('小号A')).toBeTruthy();
    });
  });

  it('抓取完成（status=done + comment_count=5）→ 显示「抓取完成 5 条」', async () => {
    // sessions
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { sessions: [{ account_label: 'A', role: 'burner', status: 'active', account_nickname: 'A' }] },
      }),
    } as any);
    // crawl-tasks/latest
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { status: 'done', comment_count: 5, lead_write_status: 'success' },
      }),
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/抓取完成.*5/)).toBeTruthy();
    });
  });

  it('comment_count=0 → 显示「该视频暂无评论」', async () => {
    // sessions
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { sessions: [{ account_label: 'A', role: 'burner', status: 'active' }] } }),
    } as any);
    // crawl-tasks/latest
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { status: 'done', comment_count: 0 } }),
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/该视频暂无评论/)).toBeTruthy();
    });
  });
});
