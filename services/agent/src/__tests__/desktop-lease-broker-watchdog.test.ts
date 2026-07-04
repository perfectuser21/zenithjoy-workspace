// services/agent/src/__tests__/desktop-lease-broker-watchdog.test.ts
//
// Bug 6 (watchdog pendingPreempt 泄漏) regression — 1.0.107 staging 重测发现：
//
// _runWatchdog 发现 currentLease 过期后清空 currentLease，但未处理 pendingPreempt。
// pendingPreempt 的超时回调（yieldWaitMs 后）仍会执行：
//   `this.currentLease = null;`  ← 此时 currentLease 可能是新租约（第三方刚获取）
// → 合法新租约被野 timeout 清零，等同于 phantom 撤销。
//
// 修法：_runWatchdog 清除过期 currentLease 后，若 pendingPreempt 存在，
// 立即 clearTimeout + resolve 新租约（复用 release() 的同款逻辑），绝不留野定时器。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DesktopLeaseBroker } from '../desktop-lease-broker';

describe('DesktopLeaseBroker — watchdog pendingPreempt cleanup [Bug 6 regression]', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('watchdog 清除过期 lease 后立即授予 pendingPreempt，绝不留野 timeout', async () => {
    const broker = new DesktopLeaseBroker({ ttlMs: 1000, yieldWaitMs: 5000 });

    // 低优先级 clientA 先获取租约（ttl=1s）
    const r1 = await broker.acquire({ clientId: 'clientA', priority: 100, ttlMs: 1000 });
    expect(r1.granted).toBe(true);

    // 高优先级 clientB 发起抢占（生成 pendingPreempt + 野 timeout 5s）
    const p2 = broker.acquire({ clientId: 'clientB', priority: 10, ttlMs: 2000 });

    // pendingPreempt 已就位，但 timeout 还没触发（5s 后才触发）
    // 现在让 watchdog 先触发（clientA 的租约 1s 后过期）
    vi.advanceTimersByTime(1001); // watchdog 检测到 clientA 过期

    // watchdog 应该立即 resolve pendingPreempt（clientB 获得租约）
    const r2 = await p2;
    expect(r2.granted).toBe(true, 'watchdog 过期后应立即 resolve pendingPreempt');
    expect(r2.lease_id).toBeTruthy();

    // 野 timeout（原 yieldWaitMs=5s）不应在 5s 后再次触发，清空 currentLease
    const leaseIdAfterWatchdog = r2.lease_id;
    vi.advanceTimersByTime(5000); // 让野 timeout 有机会触发

    // clientB 的租约在 watchdog 处理后应仍然有效（野 timeout 已被 clear）
    const renew = await broker.renew({ clientId: 'clientB', leaseId: leaseIdAfterWatchdog! });
    expect(renew.ok).toBe(true, 'watchdog 后 clientB 租约应仍有效（野 timeout 已 clearTimeout）');

    broker.destroy();
  });

  it('watchdog 触发且无 pendingPreempt 时：只清 currentLease，无副作用', async () => {
    const broker = new DesktopLeaseBroker({ ttlMs: 500, yieldWaitMs: 3000 });

    const r1 = await broker.acquire({ clientId: 'solo', priority: 50, ttlMs: 500 });
    expect(r1.granted).toBe(true);

    let watchdogFired = false;
    broker.onWatchdogTrigger = () => { watchdogFired = true; };

    vi.advanceTimersByTime(600); // 过期

    expect(watchdogFired).toBe(true);

    // 无 pendingPreempt：watchdog 后 currentLease=null，新 acquire 能正常获取
    const r2 = await broker.acquire({ clientId: 'newClient', priority: 50, ttlMs: 1000 });
    expect(r2.granted).toBe(true, 'watchdog 后无 pending，新 acquire 应正常获取');

    broker.destroy();
  });
});
