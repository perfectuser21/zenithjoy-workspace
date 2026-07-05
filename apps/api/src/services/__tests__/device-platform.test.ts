import { describe, it, expect } from 'vitest';
import { resolveDevicePlatform, isDuplicateDmOutreachResult } from '../device-platform';

// 配套 test-pairing lint 要求的同目录 __tests__ 文件（CI lint-test-pairing.sh 强制要求）。
// 权威合同断言在 sprints/07052218-douyin-dm-outreach-android/tests/device-platform.test.ts，
// 本文件是同一模块的补充冒烟，不替代合同测试。

describe('resolveDevicePlatform', () => {
  it('capabilities 含 android → 返回 android', () => {
    expect(resolveDevicePlatform(['android'])).toBe('android');
  });

  it('capabilities 不含 android → 返回 windows', () => {
    expect(resolveDevicePlatform([])).toBe('windows');
    expect(resolveDevicePlatform(['some-other-cap'])).toBe('windows');
  });

  it('capabilities 为 null/undefined → 返回 windows，不抛异常', () => {
    expect(resolveDevicePlatform(null as unknown as string[])).toBe('windows');
    expect(resolveDevicePlatform(undefined as unknown as string[])).toBe('windows');
  });
});

describe('isDuplicateDmOutreachResult', () => {
  it('终态(sent/limited/failed) → 判定为重复', () => {
    expect(isDuplicateDmOutreachResult('sent')).toBe(true);
    expect(isDuplicateDmOutreachResult('limited')).toBe(true);
    expect(isDuplicateDmOutreachResult('failed')).toBe(true);
  });

  it('非终态(queued/dispatched) → 判定非重复', () => {
    expect(isDuplicateDmOutreachResult('queued')).toBe(false);
    expect(isDuplicateDmOutreachResult('dispatched')).toBe(false);
  });

  it('assignment 未找到(null) → 判定非重复', () => {
    expect(isDuplicateDmOutreachResult(null)).toBe(false);
  });
});
