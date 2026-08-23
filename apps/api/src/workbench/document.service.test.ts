/**
 * document.service 纯单元测试（无 DB）—— 只钉不依赖数据库的导出。
 * 真三档可见性 / 六处过滤 / most-restrictive 继承 / fail-closed 503 由合同 permissions.test.ts
 * 与 cross-tenant-isolation.test.ts（真 Postgres）覆盖，本文件不碰它们。
 */
import { describe, it, expect } from 'vitest';
import { isUuid, DocumentValidationError } from './document.service';

describe('document.service.isUuid', () => {
  it('合法 uuid 通过', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });
  it('非 uuid（含 tree / search / 非法字符）不通过', () => {
    expect(isUuid('tree')).toBe(false);
    expect(isUuid('search')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('document.service.DocumentValidationError', () => {
  it('是 Error 且带具名 name（路由据此翻 400）', () => {
    const e = new DocumentValidationError('正文非法');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DocumentValidationError');
    expect(e.message).toBe('正文非法');
  });
});
