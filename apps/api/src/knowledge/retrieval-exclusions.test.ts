/**
 * A35① 排除清单的形状与语义。纯常量断言，不碰任何真实世界的边。
 */
import { describe, it, expect } from 'vitest';
import { RETRIEVAL_EXCLUDED_TABLES, isRetrievalExcluded } from './retrieval-exclusions';

describe('retrieval-exclusions', () => {
  it('五张路③ 物理表逐字在清单里', () => {
    for (const t of ['db_tables', 'db_fields', 'db_rows', 'db_view_prefs', 'db_audit']) {
      expect(RETRIEVAL_EXCLUDED_TABLES).toContain(t);
    }
  });

  it('清单无重复项 —— 重复会让"删掉一个还剩一个"这种半删悄悄通过', () => {
    expect(new Set(RETRIEVAL_EXCLUDED_TABLES).size).toBe(RETRIEVAL_EXCLUDED_TABLES.length);
  });

  it('isRetrievalExcluded 只对清单内表名为真', () => {
    expect(isRetrievalExcluded('db_rows')).toBe(true);
    // 知识中枢自己的投影表不在排除域里，否则路① 的问答会被一起关掉
    expect(isRetrievalExcluded('knowledge_entries_projection')).toBe(false);
    expect(isRetrievalExcluded('')).toBe(false);
  });
});
