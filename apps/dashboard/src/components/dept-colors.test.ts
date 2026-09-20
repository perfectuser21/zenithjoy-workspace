import { describe, it, expect } from 'vitest';
import { DEPT_BLOCK } from './dept-colors';
import { DEPTS } from '../api/schedule.api';

describe('部门配色', () => {
  it('每个部门都有配色，漏一个甘特色块就会是 undefined 崩掉', () => {
    for (const d of DEPTS) {
      expect(DEPT_BLOCK[d]).toBeDefined();
      expect(DEPT_BLOCK[d].bg).toMatch(/^bg-/);
      expect(DEPT_BLOCK[d].bar).toMatch(/^bg-/);
      expect(DEPT_BLOCK[d].text).toMatch(/^text-/);
    }
  });

  it('各部门颜色互不相同，否则甘特图上分不出是哪条线', () => {
    const bars = DEPTS.map((d) => DEPT_BLOCK[d].bar);
    expect(new Set(bars).size).toBe(DEPTS.length);
  });

  it('不多不少，正好覆盖约定的部门清单', () => {
    expect(Object.keys(DEPT_BLOCK).sort()).toEqual([...DEPTS].sort());
  });
});
