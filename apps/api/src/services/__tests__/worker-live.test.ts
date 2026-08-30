import { describe, it, expect, vi } from 'vitest';
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
});
