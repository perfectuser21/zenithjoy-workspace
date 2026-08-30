/**
 * worker-lease-sweeper 单测（test-pairing lint 配对）。
 *
 * 迁出背景：原逻辑内嵌在 app.ts 里，随模块 import 时机立即 setInterval，无法在
 * vitest 单测里干净地控制/断言；迁到独立 service 后可用 fake timers 直接验证。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../worker-tasks-service', () => ({
  sweepExpiredLeases: vi.fn(),
}));
vi.mock('../worker-live', () => ({
  workerLive: { evictIdle: vi.fn() },
}));

import { sweepExpiredLeases } from '../worker-tasks-service';
import { workerLive } from '../worker-live';
import { startWorkerLeaseSweeper, stopWorkerLeaseSweeper } from '../worker-lease-sweeper';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (sweepExpiredLeases as ReturnType<typeof vi.fn>).mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startWorkerLeaseSweeper', () => {
  it('按 intervalMs 定时调用 sweepExpiredLeases 与 workerLive.evictIdle', async () => {
    const t = startWorkerLeaseSweeper(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(1);
    expect(workerLive.evictIdle).toHaveBeenCalledTimes(1);
    stopWorkerLeaseSweeper(t);
  });

  it('stopWorkerLeaseSweeper 之后不再调用', async () => {
    const t = startWorkerLeaseSweeper(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(1);
    stopWorkerLeaseSweeper(t);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(1);
    expect(workerLive.evictIdle).toHaveBeenCalledTimes(1);
  });

  it('有过期租约时用 console.info 记录条数（不是 console.log）', async () => {
    (sweepExpiredLeases as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const t = startWorkerLeaseSweeper(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(/2 个任务租约过期/));
    expect(logSpy).not.toHaveBeenCalled();
    stopWorkerLeaseSweeper(t);
    infoSpy.mockRestore(); logSpy.mockRestore();
  });

  it('sweepExpiredLeases reject 时不向外抛异常（catch 打日志）', async () => {
    (sweepExpiredLeases as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = startWorkerLeaseSweeper(1000);
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    stopWorkerLeaseSweeper(t);
    errSpy.mockRestore();
  });
});
