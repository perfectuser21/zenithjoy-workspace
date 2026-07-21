/**
 * 全宽独立页面（不渲染 sidebar/header）路由判定
 *
 * 仅保留仍由 dashboard 承载的全宽页。Staff Hub 拆分后，/staff/skill-eval 已不再属于
 * dashboard 的 full-bleed 路由集合。
 */
import { describe, it, expect } from 'vitest';
import { isFullBleedPath } from '../full-bleed-routes';

describe('isFullBleedPath', () => {
  it('[BEHAVIOR] /staff/skill-eval 已迁出 dashboard，不再判定为全宽独立页面', () => {
    expect(isFullBleedPath('/staff/skill-eval')).toBe(false);
  });

  it('/content-factory/:id/output 仍判定为全宽独立页面（既有行为不回归）', () => {
    expect(isFullBleedPath('/content-factory/abc123/output')).toBe(true);
    expect(isFullBleedPath('/content-factory/abc123/output/')).toBe(true);
  });

  it('普通业务页不是全宽独立页面', () => {
    expect(isFullBleedPath('/dashboard')).toBe(false);
    expect(isFullBleedPath('/staff')).toBe(false);
    expect(isFullBleedPath('/admin/customers')).toBe(false);
  });
});
