import { describe, it, expect } from 'vitest';
// 目标模块尚未实现 → import 即红（TDD Red）
// Generator 需在 apps/api/src/services/device-platform.ts 新增该纯函数，
// 供 acquisition-dispatch.ts 的 dispatchDue 在派单时决定 publish_tasks.payload.device_platform。
import {
  resolveDevicePlatform,
  isDuplicateDmOutreachResult,
} from '../../../apps/api/src/services/device-platform';

describe('resolveDevicePlatform [BEHAVIOR]', () => {
  it('capabilities 含 android → 返回 android', () => {
    expect(resolveDevicePlatform(['android'])).toBe('android');
  });

  it('capabilities 不含 android → 返回 windows（默认执行通道，向后兼容）', () => {
    expect(resolveDevicePlatform([])).toBe('windows');
    expect(resolveDevicePlatform(['some-other-cap'])).toBe('windows');
  });

  it('capabilities 为 null/undefined → 返回 windows（不抛异常）', () => {
    expect(resolveDevicePlatform(null as unknown as string[])).toBe('windows');
    expect(resolveDevicePlatform(undefined as unknown as string[])).toBe('windows');
  });
});

describe('isDuplicateDmOutreachResult [BEHAVIOR] — /dm-outreach-result 幂等判定', () => {
  it('同一 dm_assignment_id 已经是终态(sent/limited/failed) → 判定为重复，不应再计数', () => {
    expect(isDuplicateDmOutreachResult('sent')).toBe(true);
    expect(isDuplicateDmOutreachResult('limited')).toBe(true);
    expect(isDuplicateDmOutreachResult('failed')).toBe(true);
  });

  it('dm_assignment 当前仍是 queued/dispatched（未终态）→ 判定非重复，允许正常写入', () => {
    expect(isDuplicateDmOutreachResult('queued')).toBe(false);
    expect(isDuplicateDmOutreachResult('dispatched')).toBe(false);
  });

  it('dm_assignment 状态为 null（未找到该 assignment）→ 判定非重复（交给上层报 404/正常处理，不是幂等短路）', () => {
    expect(isDuplicateDmOutreachResult(null)).toBe(false);
  });
});
