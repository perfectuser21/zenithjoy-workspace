/**
 * s4-c2-tiered-read.test.mjs
 * BEHAVIOR-4: S4-c2 三档取数
 *
 * 档1：页面同时有掉线/上线时刻 → 计算差值（分钟）
 * 档2：只有上线时刻 + run-summary.device_reboot_at → 计算差值
 * 档3：两个时刻都无 → reason='human_only'
 *
 * 这是 failing test（commit-1），实现完成后（commit-4）应全绿。
 */

/**
 * 待 capture.mjs 实现后从真实模块导入：
 * import { computeS4C2RecoveryWindow } from '../../../scripts/acceptance-spec/ai-run/capture.mjs';
 *
 * 函数签名：
 * computeS4C2RecoveryWindow({ pageText, deviceRebootAt })
 * 返回：{ value_minutes?: number, reason?: string, tier: 1|2|3 }
 */

async function loadComputeS4C2() {
  try {
    const mod = await import('../../../scripts/acceptance-spec/ai-run/capture.mjs');
    if (typeof mod.computeS4C2RecoveryWindow === 'function') return mod.computeS4C2RecoveryWindow;
  } catch {
    // 尚未实现 → failing test
  }
  return null;
}

describe('BEHAVIOR-4: S4-c2 三档取数', () => {
  let computeS4C2;

  beforeAll(async () => {
    computeS4C2 = await loadComputeS4C2();
  });

  test('档1：页面含掉线时刻(2026-08-07 10:00)和上线时刻(2026-08-07 10:15)，计算差值=15分钟', async () => {
    expect(computeS4C2).not.toBeNull(); // capture.mjs 必须导出 computeS4C2RecoveryWindow

    const result = await computeS4C2({
      pageText: '设备离线时间: 2026-08-07 10:00:00\n设备上线时间: 2026-08-07 10:15:00\nSM-A536B',
      deviceRebootAt: null,
    });

    expect(result.tier).toBe(1);
    expect(result.value_minutes).toBe(15);
    expect(result.reason).toBeUndefined();
  });

  test('档2：页面只有上线时刻，run-summary 有 device_reboot_at，计算差值', async () => {
    expect(computeS4C2).not.toBeNull();

    const rebootAt = new Date('2026-08-07T10:00:00Z').toISOString();
    const onlineAt = '2026-08-07 10:08:00'; // 页面上只有上线时刻

    const result = await computeS4C2({
      pageText: `设备上线时间: ${onlineAt}\nSM-A536B`,
      deviceRebootAt: rebootAt,
    });

    expect(result.tier).toBe(2);
    expect(result.value_minutes).toBeGreaterThan(0);
    expect(result.value_minutes).toBeLessThanOrEqual(15);
  });

  test('档3：页面无任何时刻，device_reboot_at 也无，返回 reason=human_only', async () => {
    expect(computeS4C2).not.toBeNull();

    const result = await computeS4C2({
      pageText: '设备列表\nSM-A536B\n在线',
      deviceRebootAt: null,
    });

    expect(result.tier).toBe(3);
    expect(result.reason).toBe('human_only');
    expect(result.value_minutes).toBeUndefined();
  });
});
