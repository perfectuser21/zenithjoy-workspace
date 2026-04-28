/**
 * 单元覆盖：license.api 客户端导出契约
 *
 * 真实端到端行为在 LicensePage / AdminLicensePage 测试中通过 mock 验证。
 * 这里只确保 4 个 client 函数被导出且为函数。
 */
import { describe, it, expect } from 'vitest';
import {
  fetchMyLicense,
  listAllLicenses,
  createLicense,
  revokeLicense,
} from '../license.api';

describe('api/license.api', () => {
  it('导出 fetchMyLicense', () => {
    expect(typeof fetchMyLicense).toBe('function');
  });

  it('导出 listAllLicenses', () => {
    expect(typeof listAllLicenses).toBe('function');
  });

  it('导出 createLicense', () => {
    expect(typeof createLicense).toBe('function');
  });

  it('导出 revokeLicense', () => {
    expect(typeof revokeLicense).toBe('function');
  });
});
