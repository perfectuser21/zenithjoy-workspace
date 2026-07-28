/**
 * 合同测试骨架 — BEHAVIOR-SUBMIT-STATUS
 *
 * 验证提交汇总逻辑：
 *   - 全 PASS → run.status = PASS
 *   - 任一 BLOCKED → run.status = BLOCKED
 *   - 任一 FAIL（无 BLOCKED）→ run.status = FAIL
 *   - 已 submitted 再次 submit → 409
 *
 * 注：本测试为纯函数层单测（不依赖 DB），覆盖汇总逻辑核心。
 * API 集成测试见 apps/api/src/routes/__tests__/ 目录。
 */

import { describe, it, expect } from 'vitest';

/**
 * 汇总逻辑纯函数（待实现路径：apps/api/src/routes/ability-acceptance.ts）
 * 这里作为合同骨架先定义接口和预期行为。
 */
type DeviceStatus = 'PASS' | 'FAIL' | 'BLOCKED';
type RunStatus = 'PASS' | 'FAIL' | 'BLOCKED';

/**
 * 合同约定的汇总函数签名。
 * 实现方将此函数导出后，删除此 stub 并 import 真实实现。
 */
function computeRunStatus(deviceStatuses: DeviceStatus[]): RunStatus {
  // STUB — 实现时替换为真实逻辑
  // 规则：任一 BLOCKED → BLOCKED；任一 FAIL → FAIL；全 PASS → PASS
  if (deviceStatuses.includes('BLOCKED')) return 'BLOCKED';
  if (deviceStatuses.includes('FAIL')) return 'FAIL';
  return 'PASS';
}

describe('[BEHAVIOR-SUBMIT-STATUS] run 提交汇总状态计算', () => {
  it('全 5 台设备 PASS → 汇总 PASS', () => {
    const result = computeRunStatus(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    expect(result).toBe('PASS');
  });

  it('任一设备 BLOCKED（其余 PASS）→ 汇总 BLOCKED', () => {
    const result = computeRunStatus(['PASS', 'PASS', 'BLOCKED', 'PASS', 'PASS']);
    expect(result).toBe('BLOCKED');
  });

  it('任一设备 BLOCKED + 任一 FAIL → 汇总 BLOCKED（BLOCKED 优先）', () => {
    const result = computeRunStatus(['FAIL', 'BLOCKED', 'PASS', 'PASS', 'PASS']);
    expect(result).toBe('BLOCKED');
  });

  it('任一设备 FAIL（无 BLOCKED）→ 汇总 FAIL', () => {
    const result = computeRunStatus(['PASS', 'FAIL', 'PASS', 'PASS', 'PASS']);
    expect(result).toBe('FAIL');
  });

  it('单台设备 PASS → 汇总 PASS', () => {
    const result = computeRunStatus(['PASS']);
    expect(result).toBe('PASS');
  });
});

describe('[BEHAVIOR-SUBMIT-STATUS] API 重复提交返回 409', () => {
  it('已 submitted run 再次 POST submit → 409（API 集成测试占位）', async () => {
    const API_BASE = process.env.API_BASE;
    const STAFF_EMAIL = process.env.STAFF_EMAIL;
    const SUBMITTED_RUN_ID = process.env.SUBMITTED_RUN_ID;

    if (!API_BASE || !STAFF_EMAIL || !SUBMITTED_RUN_ID) {
      console.warn('API_BASE/STAFF_EMAIL/SUBMITTED_RUN_ID 未设置，跳过重复提交 409 测试');
      return;
    }

    const res = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs/${SUBMITTED_RUN_ID}/submit`, {
      method: 'POST',
      headers: { 'X-User-Email': STAFF_EMAIL },
    });
    expect(res.status).toBe(409);
  });
});
