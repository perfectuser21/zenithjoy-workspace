/**
 * Regression test: LeadsPage AG Grid 高度链 bug（GitHub #1023）
 *
 * 根因：ag-theme-quartz-dark 容器使用 height:'100%' 依赖父链高度；
 * App.tsx 的 p-8 包装层 height:auto，导致 h-full 计算为 0 → AG Grid 不可见。
 * 修法：改固定像素高度（≥400），与 CustomerListPage 对齐。
 *
 * 本 test 永久留 CI，防止 height:'100%' 被重新引入。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import LeadsPage from '../LeadsPage';

beforeAll(() => {
  (window as unknown as Record<string, unknown>).ResizeObserver = class ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  };

  const store: Record<string, string> = {};
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
    writable: true,
  });
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const SAMPLE_LEADS = Array.from({ length: 5 }, (_, i) => ({
  commenter_id: `用户${i}`,
  profile_url: `https://www.douyin.com/user/sec${i}`,
  comment_text: `评论内容${i}`,
  source_video_url: `https://www.douyin.com/video/${i}`,
  crawled_at: '2026-07-01T10:00:00Z',
  grade: '感兴趣',
  keyword: '美甲',
}));

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/acquisition/leads')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ leads: SAMPLE_LEADS, total: SAMPLE_LEADS.length }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  }) as unknown as typeof fetch;
});

describe('LeadsPage AG Grid 高度守卫（regression #1023）', () => {
  it('ag-theme-quartz-dark 容器必须使用固定像素高度（≥400px），禁止 height:100%', () => {
    const { container } = render(<LeadsPage />);

    const gridWrapper = container.querySelector('.ag-theme-quartz-dark') as HTMLElement | null;
    expect(gridWrapper).not.toBeNull();

    const h = gridWrapper!.style.height;
    // 修前：height 是 '100%' → 本断言会 FAIL（这是预期的 failing test）
    // 修后：height 是像素值如 '560px' → 断言通过
    expect(h).not.toBe('100%');
    const px = parseInt(h, 10);
    expect(Number.isFinite(px) && px >= 400).toBe(true);
  });
});
