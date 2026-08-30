import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerLiveBuffer } from '../worker-live';
describe('WorkerLiveBuffer', () => {
  it('pushFrame 后 latest 返回该帧与递增 seq', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 3 });
    b.pushFrame('agent-1', Buffer.from('a')); b.pushFrame('agent-1', Buffer.from('b'));
    const f = b.latest('agent-1'); expect(f?.seq).toBe(2); expect(f?.bytes.toString()).toBe('b');
  });
  it('环形：超过 maxFrames 丢最旧', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 2 });
    for (const s of ['1', '2', '3']) b.pushFrame('a', Buffer.from(s));
    expect(b.frames('a').map((f) => f.bytes.toString())).toEqual(['2', '3']);
  });
  it('订阅者收到新帧；取消后不再收到', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 2 }); const cb = vi.fn();
    const off = b.subscribe('a', cb); b.pushFrame('a', Buffer.from('x')); expect(cb).toHaveBeenCalledTimes(1);
    off(); b.pushFrame('a', Buffer.from('y')); expect(cb).toHaveBeenCalledTimes(1);
  });
  it('未知 agent latest 为 null', () => { expect(new WorkerLiveBuffer().latest('nope')).toBeNull(); });

  it('一个订阅者抛错不影响其它订阅者，pushFrame 仍返回帧', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 2 });
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    b.subscribe('a', bad);
    b.subscribe('a', good);
    const frame = b.pushFrame('a', Buffer.from('x'));
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(frame.seq).toBe(1);
    expect(b.latest('a')?.seq).toBe(1);
  });

  it('clear 后该 agent 的帧/seq/listeners 全清，latest 为 null', () => {
    const b = new WorkerLiveBuffer({ maxFrames: 2 });
    const cb = vi.fn();
    b.subscribe('a', cb);
    b.pushFrame('a', Buffer.from('x'));
    b.clear('a');
    expect(b.latest('a')).toBeNull();
    expect(b.frames('a')).toEqual([]);
    b.pushFrame('a', Buffer.from('y'));
    expect(b.latest('a')?.seq).toBe(1); // seq 从头计（clear 清了 seqs）
    expect(cb).toHaveBeenCalledTimes(1); // 之前的订阅在 clear 时已被移除，不会收到新帧
  });

  describe('evictIdle', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('只驱逐无订阅且最新帧已过期的 agent', () => {
      const b = new WorkerLiveBuffer({ maxFrames: 2 });
      b.pushFrame('idle-old', Buffer.from('1')); // 无订阅，稍后会过期
      const off = b.subscribe('has-listener', () => {});
      b.pushFrame('has-listener', Buffer.from('1')); // 有订阅，即使过期也不驱逐
      b.pushFrame('fresh', Buffer.from('1')); // 无订阅但未过期

      vi.setSystemTime(Date.now() + 11 * 60_000);
      b.pushFrame('fresh', Buffer.from('2')); // 刷新 fresh 的 at

      const evicted = b.evictIdle(10 * 60_000);
      expect(evicted).toBe(1);
      expect(b.latest('idle-old')).toBeNull();
      expect(b.latest('has-listener')).not.toBeNull();
      expect(b.latest('fresh')).not.toBeNull();
      off();
    });

    it('无帧但有空 listener Set 的 agent 也会被清掉', () => {
      const b = new WorkerLiveBuffer({ maxFrames: 2 });
      const off = b.subscribe('a', () => {});
      off(); // 取消订阅后 listeners.get('a') 是空 Set，但仍存在于 map 里
      const evicted = b.evictIdle(10 * 60_000);
      expect(evicted).toBe(1);
    });
  });
});
