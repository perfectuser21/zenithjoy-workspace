/**
 * Path 2 Sprint B-1 — apps/api/src/services/lead-writer.ts pairing placeholder
 *
 * 真行为测试在 apps/api/tests/p2-sprint-b1-ws4/lead-writer.test.ts
 * 此文件是 lint-test-pairing 配套要求。
 */
import { describe, it, expect } from 'vitest';
import * as leadWriter from './lead-writer';

describe('lead-writer 死代码清理（决策19e6480c，2026-07-14）', () => {
  it('writeLeadsFromComments 已删除，模块不再导出它', () => {
    expect((leadWriter as Record<string, unknown>).writeLeadsFromComments).toBeUndefined();
  });

  it('writeDmOutreachStatus 仍然导出（活代码，不动）', () => {
    expect(typeof leadWriter.writeDmOutreachStatus).toBe('function');
  });
});
