/**
 * License service 单元测试 — v1.2 Day 1-2
 *
 * 覆盖：
 *   - License key 格式与生成（base32 alphabet / tier 前缀 / 100 次唯一性）
 *   - HMAC ws_token sign/verify（含 timing-safe 比较）
 *   - TIER_QUOTA 套餐配额定义
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateLicenseKey,
  isValidLicenseKeyFormat,
  signWsToken,
  verifyWsToken,
  TIER_QUOTA,
} from '../../src/services/license.service';

describe('license.service: key 格式和生成', () => {
  it('generateLicenseKey 各 tier 前缀正确', () => {
    expect(generateLicenseKey('basic')).toMatch(/^ZJ-B-[A-Z2-9]{8}$/);
    expect(generateLicenseKey('matrix')).toMatch(/^ZJ-M-[A-Z2-9]{8}$/);
    expect(generateLicenseKey('studio')).toMatch(/^ZJ-S-[A-Z2-9]{8}$/);
    expect(generateLicenseKey('enterprise')).toMatch(/^ZJ-E-[A-Z2-9]{8}$/);
  });

  it('生成的 key 不重复（100 次取样唯一）', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(generateLicenseKey('basic'));
    }
    expect(set.size).toBe(100);
  });

  it('isValidLicenseKeyFormat 正例', () => {
    expect(isValidLicenseKeyFormat('ZJ-B-ABCDEFGH')).toBe(true);
    expect(isValidLicenseKeyFormat('ZJ-M-23456789')).toBe(true);
    expect(isValidLicenseKeyFormat('ZJ-S-PQRSTVWX')).toBe(true);
    expect(isValidLicenseKeyFormat('ZJ-E-YZ234567')).toBe(true);
  });

  it('isValidLicenseKeyFormat 反例', () => {
    expect(isValidLicenseKeyFormat('')).toBe(false);
    expect(isValidLicenseKeyFormat('ZJ-X-ABCDEFGH')).toBe(false); // 错前缀
    expect(isValidLicenseKeyFormat('ZJ-B-ABC')).toBe(false); // 长度不对
    expect(isValidLicenseKeyFormat('xj-b-abcdefgh')).toBe(false); // 小写
    expect(isValidLicenseKeyFormat('ZJ-B-ABCDEFG1')).toBe(false); // alphabet 排除 1
    expect(isValidLicenseKeyFormat('ZJ-B-ABCDEFG0')).toBe(false); // alphabet 排除 0
  });

  it('TIER_QUOTA 套餐配额定义正确', () => {
    expect(TIER_QUOTA.basic).toBe(1);
    expect(TIER_QUOTA.matrix).toBe(3);
    expect(TIER_QUOTA.studio).toBe(10);
    expect(TIER_QUOTA.enterprise).toBe(30);
  });
});

describe('license.service: ws_token HMAC', () => {
  beforeEach(() => {
    process.env.LICENSE_HMAC_SECRET = 'test-secret-at-least-16-chars-long'; // gitleaks:allow
  });

  it('sign 同一 (license,machine) 结果稳定', () => {
    const t1 = signWsToken('lic-1', 'machine-A');
    const t2 = signWsToken('lic-1', 'machine-A');
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同 machine 生成不同 token', () => {
    expect(signWsToken('lic-1', 'machine-A')).not.toBe(
      signWsToken('lic-1', 'machine-B')
    );
  });

  it('verifyWsToken 正确接受合法 token', () => {
    const t = signWsToken('lic-1', 'machine-A');
    expect(verifyWsToken('lic-1', 'machine-A', t)).toBe(true);
  });

  it('verifyWsToken 拒绝错 license/machine/token', () => {
    const t = signWsToken('lic-1', 'machine-A');
    expect(verifyWsToken('lic-2', 'machine-A', t)).toBe(false);
    expect(verifyWsToken('lic-1', 'machine-B', t)).toBe(false);
    expect(verifyWsToken('lic-1', 'machine-A', '00'.repeat(32))).toBe(false);
    expect(verifyWsToken('lic-1', 'machine-A', '')).toBe(false);
  });
});
