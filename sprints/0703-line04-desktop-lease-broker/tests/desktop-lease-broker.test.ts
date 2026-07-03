// Sprint 0703-line04-desktop-lease-broker — DesktopLeaseBroker 状态机单元测试
// TDD commit-1（红）：DesktopLeaseBroker 未实现，import 失败 → 所有测试 FAIL

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 此 import 在 Generator 实现前必然 FAIL（文件不存在）
// 这是期望的 Red 状态
import { DesktopLeaseBroker } from '../../../services/agent/src/desktop-lease-broker.js';

describe('DesktopLeaseBroker — 状态机（acquire / renew / release / watchdog）', () => {
  let broker: DesktopLeaseBroker;

  beforeEach(() => {
    // 使用可控时钟避免真实 setInterval 拖慢测试
    vi.useFakeTimers();
    broker = new DesktopLeaseBroker({ ttlMs: 10000, watchdogIntervalMs: 5000 });
  });

  afterEach(() => {
    broker.destroy(); // 清理 setInterval
    vi.useRealTimers();
  });

  // ── acquire ──────────────────────────────────────────────────────────────

  it('acquire 空闲状态返回 granted:true，lease_id 为非空字符串，expires_at > now', async () => {
    const before = Date.now();
    const result = await broker.acquire({
      clientId: 'line04/listen_chat',
      priority: 50,
      ttlMs: 10000,
    });

    expect(result.granted).toBe(true);
    expect(typeof result.lease_id).toBe('string');
    expect(result.lease_id!.length).toBeGreaterThan(0);
    expect(result.expires_at).toBeGreaterThan(before);
    expect(result.expires_at! - before).toBeGreaterThanOrEqual(9000); // ~10000ms
  });

  it('低优先级（priority=50）在高优先级（priority=0）持有时 → granted:false + retry_after_ms>0', async () => {
    // 先以高优先级（priority=0）获取租约
    const first = await broker.acquire({ clientId: 'human_operator', priority: 0, ttlMs: 10000 });
    expect(first.granted).toBe(true);

    // 低优先级请求被拒
    const second = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(second.granted).toBe(false);
    expect(second.retry_after_ms).toBeGreaterThan(0);
  });

  it('acquire 同等优先级持有中 → granted:false，原持有方 lease 未被清除', async () => {
    const first = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(first.granted).toBe(true);

    const second = await broker.acquire({ clientId: 'line02/other', priority: 50, ttlMs: 10000 });
    expect(second.granted).toBe(false);

    // 原持有方仍可 renew（lease 未被清除）
    const renew = await broker.renew({ leaseId: first.lease_id!, clientId: 'line04/listen_chat' });
    expect(renew.ok).toBe(true);
  });

  // ── renew ────────────────────────────────────────────────────────────────

  it('renew 续期返回 ok:true，expires_at 重置为 now + ttlMs', async () => {
    const acquired = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(acquired.granted).toBe(true);

    // 模拟经过 4s（未超期）
    vi.advanceTimersByTime(4000);
    const renewBefore = Date.now();

    const result = await broker.renew({
      leaseId: acquired.lease_id!,
      clientId: 'line04/listen_chat',
    });

    expect(result.ok).toBe(true);
    // expires_at 应重置（≥ now + 9s）
    expect(result.expires_at! - renewBefore).toBeGreaterThanOrEqual(9000);
  });

  it('非持有方发 renew → {ok:false, reason:"not_owner"}', async () => {
    const acquired = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(acquired.granted).toBe(true);

    const result = await broker.renew({
      leaseId: acquired.lease_id!,
      clientId: 'line02/other_agent', // 不是持有方
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_owner');
  });

  it('renew 不存在的 lease_id → {ok:false, reason:"lease_not_found"}', async () => {
    const result = await broker.renew({
      leaseId: 'non-existent-uuid',
      clientId: 'line04/listen_chat',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('lease_not_found');
  });

  // ── release ──────────────────────────────────────────────────────────────

  it('release 清除租约，状态变 null，返回 {ok:true}', async () => {
    const acquired = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(acquired.granted).toBe(true);

    const result = await broker.release({
      leaseId: acquired.lease_id!,
      clientId: 'line04/listen_chat',
    });

    expect(result.ok).toBe(true);

    // release 后应可立即重新获取
    const second = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(second.granted).toBe(true);
  });

  it('重复 release 同一 lease_id 幂等 — 两次均返回 {ok:true}', async () => {
    const acquired = await broker.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 10000 });
    expect(acquired.granted).toBe(true);

    const r1 = await broker.release({ leaseId: acquired.lease_id!, clientId: 'line04/listen_chat' });
    const r2 = await broker.release({ leaseId: acquired.lease_id!, clientId: 'line04/listen_chat' });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true); // 幂等
  });

  // ── watchdog ─────────────────────────────────────────────────────────────

  it('TTL 超期后看门狗自动释放 lease（≤15s，模拟时钟）', async () => {
    const onWatchdogTrigger = vi.fn();
    const b2 = new DesktopLeaseBroker({
      ttlMs: 1000, // 缩短 TTL 加快测试
      watchdogIntervalMs: 500,
      onWatchdogTrigger,
    });

    const acquired = await b2.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 1000 });
    expect(acquired.granted).toBe(true);

    // 推进时钟触发看门狗（1000ms TTL + 500ms 轮询 = 最多 1500ms）
    vi.advanceTimersByTime(2000);

    // 看门狗已触发
    expect(onWatchdogTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'line04/listen_chat' })
    );

    // Broker 内部 lease 已清除
    const newAcquire = await b2.acquire({ clientId: 'line02/other', priority: 50, ttlMs: 1000 });
    expect(newAcquire.granted).toBe(true);

    b2.destroy();
  });

  it('看门狗触发时调用 onBrainLog 回调（tenant_id 非空，符合租户隔离 invariant）', async () => {
    const onBrainLog = vi.fn();
    const b3 = new DesktopLeaseBroker({
      ttlMs: 500,
      watchdogIntervalMs: 250,
      onBrainLog,
      tenantId: 'tenant-test-001',
    });

    await b3.acquire({ clientId: 'line04/listen_chat', priority: 50, ttlMs: 500 });
    vi.advanceTimersByTime(1000);

    expect(onBrainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'desktop_lease_watchdog_triggered',
        module: 'desktop_lease',
        level: 'warn',
        context: expect.objectContaining({ tenant_id: 'tenant-test-001' }),
      })
    );

    b3.destroy();
  });
});
