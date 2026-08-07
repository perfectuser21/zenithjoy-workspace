/**
 * preflight-check.test.mjs
 * BEHAVIOR-3: capture.mjs 开跑前双自检
 *
 * 验证：租户不匹配 → 非零退出；设备不在线 → 非零退出；两者都满足 → 通过
 *
 * 这是 failing test（commit-1），实现完成后（commit-4）应全绿。
 */

import { jest } from '@jest/globals';

/**
 * 采证前自检函数签名（待 capture.mjs 实现后从真实模块导入）
 * preflightCheck({ tenantId, acceptanceTenantId, machinesOnline, requiredDeviceModel, runSummaryDevices })
 * 返回 { ok: boolean, reason?: string }
 */

// 由于 capture.mjs 尚未导出 preflightCheck，我们测试其行为约定
// 实现后替换为：import { preflightCheck } from '../../../scripts/acceptance-spec/ai-run/capture.mjs';

async function loadPreflightCheck() {
  try {
    const mod = await import('../../../scripts/acceptance-spec/ai-run/capture.mjs');
    if (typeof mod.preflightCheck === 'function') return mod.preflightCheck;
  } catch {
    // capture.mjs 不导出 preflightCheck → 测试失败（预期 failing test）
  }
  return null;
}

describe('BEHAVIOR-3: capture.mjs 开跑前双自检', () => {
  let preflightCheck;

  beforeAll(async () => {
    preflightCheck = await loadPreflightCheck();
  });

  test('租户 ID 不匹配时返回 ok=false 且 reason 含 ai_incomplete', async () => {
    expect(preflightCheck).not.toBeNull(); // capture.mjs 必须导出 preflightCheck

    const result = await preflightCheck({
      tenantId: 'tenant-wrong-123',
      acceptanceTenantId: 'tenant-acceptance-456',
      machinesOnline: 4,
      requiredDeviceModel: 'SM-A536B',
      runSummaryDevices: ['SM-A536B', 'SM-A536C'],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ai_incomplete|tenant.*mismatch|租户不匹配/i);
  });

  test('设备不在线时返回 ok=false 且 reason 含 ai_incomplete', async () => {
    expect(preflightCheck).not.toBeNull();

    const result = await preflightCheck({
      tenantId: 'tenant-acceptance-456',
      acceptanceTenantId: 'tenant-acceptance-456',
      machinesOnline: 0, // 零在线机
      requiredDeviceModel: 'SM-A536B',
      runSummaryDevices: [],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ai_incomplete|no.*device|设备.*不在线/i);
  });

  test('设备在线但不含单头 device_model 时返回 ok=false', async () => {
    expect(preflightCheck).not.toBeNull();

    const result = await preflightCheck({
      tenantId: 'tenant-acceptance-456',
      acceptanceTenantId: 'tenant-acceptance-456',
      machinesOnline: 3,
      requiredDeviceModel: 'SM-A536B',
      runSummaryDevices: ['SM-G998B', 'SM-A525F'], // 不含 SM-A536B
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ai_incomplete|device.*not.*found|单头设备不在列表/i);
  });

  test('租户匹配且单头设备在线时返回 ok=true', async () => {
    expect(preflightCheck).not.toBeNull();

    const result = await preflightCheck({
      tenantId: 'tenant-acceptance-456',
      acceptanceTenantId: 'tenant-acceptance-456',
      machinesOnline: 4,
      requiredDeviceModel: 'SM-A536B',
      runSummaryDevices: ['SM-A536B', 'SM-G998B'],
    });

    expect(result.ok).toBe(true);
  });
});
