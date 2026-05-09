import { describe, it, expect } from 'vitest';
import { isValidLicenseKeyFormat } from './license.service';

describe('isValidLicenseKeyFormat — Sprint 2.1f Fix 3', () => {
  // 这些是历史真客户的 hex 字符 license，旧正则 [A-Z2-9]{8} 会拒
  it('接受 hex 字符 license（含 0/1）— ZJ-F-44D00A51', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-44D00A51')).toBe(true);
  });

  it('接受 hex 字符 license — ZJ-F-AA724212', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-AA724212')).toBe(true);
  });

  it('接受 hex 字符 license — ZJ-F-B2D0AEE8', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-B2D0AEE8')).toBe(true);
  });

  // 已有 base32 license 必须继续接受
  it('接受 base32 license — ZJ-F-K3MYP4VR', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-K3MYP4VR')).toBe(true);
  });

  it('接受 ZJ-F-AAAAAAAA（极端但合法）', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-AAAAAAAA')).toBe(true);
  });

  it('拒长度不足 — ZJ-F-AAAA', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-AAAA')).toBe(false);
  });

  it('拒小写 — zj-f-aaaaaaaa', () => {
    expect(isValidLicenseKeyFormat('zj-f-aaaaaaaa')).toBe(false);
  });

  it('拒非法 tier prefix — ZJ-X-AAAAAAAA', () => {
    expect(isValidLicenseKeyFormat('ZJ-X-AAAAAAAA')).toBe(false);
  });
});
