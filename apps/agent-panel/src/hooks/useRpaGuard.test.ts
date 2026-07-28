import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRpaGuard } from './useRpaGuard';

// fail-closed 判定点：查不到 desktop-lease-broker 状态就当 RPA 进行中，绝不擅自全屏。
describe('useRpaGuard（fail-closed轮询desktop-lease-broker）', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('broker 返回 held=true → rpaActive 变 true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ held: true }),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useRpaGuard());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('broker 返回 held=false → rpaActive 保持 false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ held: false }),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useRpaGuard());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('fetch 抛异常(网络错误) → fail-closed: rpaActive 变 true', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const { result } = renderHook(() => useRpaGuard());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('resp.ok=false(非200) → fail-closed: rpaActive 变 true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const { result } = renderHook(() => useRpaGuard());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('挂载后立即查一次（不等第一个2s轮询周期）', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ held: false }) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    renderHook(() => useRpaGuard());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
  });

  it('卸载后不再更新state（避免unmount后setState警告）', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise((r) => { resolveFetch = r; })) as unknown as typeof fetch;
    const { unmount } = renderHook(() => useRpaGuard());
    unmount();
    expect(() => {
      resolveFetch({ ok: true, json: async () => ({ held: true }) });
    }).not.toThrow();
  });
});
