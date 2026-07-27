import { describe, it, expect, afterEach } from 'vitest';
import { DesktopLeaseBroker } from '../desktop-lease-broker';

// status() 只读端点：监听主循环顶部靠它判断"CI 是否正持有更高优先级桌面租约"→ 整轮让位。
// 不占租约、不改状态；持有中返回 holder+priority，空闲/过期返回 held=false。
describe('DesktopLeaseBroker.status（只读窥视，供监听让位判定）', () => {
  let broker: DesktopLeaseBroker;
  afterEach(() => broker?.destroy());

  it('无人持租 → held=false', () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000 });
    const s = broker.status();
    expect(s.held).toBe(false);
    expect(s.client_id).toBeUndefined();
  });

  it('持有中 → held=true 且回传 client_id/priority（只读，不改租约）', async () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
    const acq = await broker.acquire({ clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 60000 });
    expect(acq.granted).toBe(true);
    const s = broker.status();
    expect(s.held).toBe(true);
    expect(s.lease_id).toBe(acq.lease_id);
    expect(s.client_id).toBe('ci/bubble-read-gate');
    expect(s.priority).toBe(10);
    expect(s.yield_acknowledged).toBe(false);
    expect(s.yield_acknowledged_by).toBeUndefined();
    // status 是只读的：再查一次仍持有，租约没被 status 消费
    expect(broker.status().held).toBe(true);
  });

  it('当前 lease ID 的静默确认成功并由 status 返回', async () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
    const acq = await broker.acquire({
      clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 60000,
    });

    expect(broker.acknowledgeYield({
      leaseId: acq.lease_id!, clientId: 'line04/listen_chat',
    })).toEqual({ ok: true });
    expect(broker.status()).toMatchObject({
      held: true,
      lease_id: acq.lease_id,
      yield_acknowledged: true,
      yield_acknowledged_by: 'line04/listen_chat',
    });
    expect(broker.status().yield_acknowledged_at).toEqual(expect.any(Number));
  });

  it('错误 lease ID 不能确认当前租约', async () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
    await broker.acquire({
      clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 60000,
    });

    expect(broker.acknowledgeYield({
      leaseId: 'stale-lease', clientId: 'line04/listen_chat',
    })).toEqual({ ok: false, reason: 'lease_mismatch' });
    expect(broker.status().yield_acknowledged).toBe(false);
  });

  it('release 后的新租约不继承旧确认', async () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
    const first = await broker.acquire({
      clientId: 'ci/first', priority: 10, ttlMs: 60000,
    });
    broker.acknowledgeYield({
      leaseId: first.lease_id!, clientId: 'line04/listen_chat',
    });
    await broker.release({ leaseId: first.lease_id!, clientId: 'ci/first' });
    const second = await broker.acquire({
      clientId: 'ci/second', priority: 10, ttlMs: 60000,
    });

    expect(second.lease_id).not.toBe(first.lease_id);
    expect(broker.status()).toMatchObject({
      lease_id: second.lease_id,
      yield_acknowledged: false,
    });
  });

  it('租约已过期（未及 watchdog）→ status 视为未持有', async () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 1 });
    await broker.acquire({ clientId: 'ci/x', priority: 10, ttlMs: 1 });
    // 等待超过 ttl（1ms）
    await new Promise((r) => setTimeout(r, 20));
    const s = broker.status();
    expect(s.held).toBe(false);
  });

  it('release 后 → held=false', async () => {
    broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
    const acq = await broker.acquire({ clientId: 'ci/x', priority: 10, ttlMs: 60000 });
    await broker.release({ leaseId: acq.lease_id!, clientId: 'ci/x' });
    expect(broker.status().held).toBe(false);
  });
});
