import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { checkRpaGuard } from '../shared/panel-rpa-guard';

// 判定点(decisions表)：desktop-lease-broker失联时的默认姿态 = fail-closed
// 查不到就当RPA进行中，绝不擅自全屏——反面是fail-open，一旦误判会挡住微信/抖音操作区，
// 与历史cloak/挪窗口E_ACCESSDENIED真机事故同型。用户已明确确认这条。
describe('checkRpaGuard（fail-closed）', () => {
  afterEach(() => vi.useRealTimers());

  it('broker 正常返回 held=true → shouldYield=true, reason=rpa_active', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ held: true });
    const result = await checkRpaGuard(fetchStatus);
    expect(result).toEqual({ shouldYield: true, reason: 'rpa_active' });
  });

  it('broker 正常返回 held=false → shouldYield=false, reason=no_rpa（可以全屏）', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ held: false });
    const result = await checkRpaGuard(fetchStatus);
    expect(result).toEqual({ shouldYield: false, reason: 'no_rpa' });
  });

  it('fetchStatus 抛异常(网络错误) → fail-closed: shouldYield=true', async () => {
    const fetchStatus = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkRpaGuard(fetchStatus);
    expect(result).toEqual({ shouldYield: true, reason: 'broker_unreachable' });
  });

  it('fetchStatus 返回 null(约定的"解析失败") → fail-closed', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(null);
    const result = await checkRpaGuard(fetchStatus);
    expect(result).toEqual({ shouldYield: true, reason: 'broker_unreachable' });
  });

  it('fetchStatus 超时(默认3s) → fail-closed，不会无限等待', async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<{ held: boolean }>(() => {});
    const fetchStatus = vi.fn().mockReturnValue(neverResolves);

    const pending = checkRpaGuard(fetchStatus);
    await vi.advanceTimersByTimeAsync(3000);

    const result = await pending;
    expect(result).toEqual({ shouldYield: true, reason: 'broker_unreachable' });
  });

  it('可自定义超时阈值', async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<{ held: boolean }>(() => {});
    const fetchStatus = vi.fn().mockReturnValue(neverResolves);

    const pending = checkRpaGuard(fetchStatus, 500);
    await vi.advanceTimersByTimeAsync(500);

    const result = await pending;
    expect(result).toEqual({ shouldYield: true, reason: 'broker_unreachable' });
  });
});
