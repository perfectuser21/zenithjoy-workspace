/**
 * Path 2 Sprint B-1 — apps/api/src/services/lead-writer.ts pairing placeholder
 *
 * 真行为测试在 apps/api/tests/p2-sprint-b1-ws4/lead-writer.test.ts
 * 此文件是 lint-test-pairing 配套要求。
 */
import { describe, it, expect } from 'vitest';
import { writeLeadsFromComments } from './lead-writer';

describe('lead-writer.ts (placeholder pairing)', () => {
  it('writeLeadsFromComments 是 function 导出（真测见 tests/p2-sprint-b1-ws4/lead-writer.test.ts）', () => {
    expect(typeof writeLeadsFromComments).toBe('function');
  });
});
