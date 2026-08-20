/**
 * A11 自检的判定形状。
 *
 * 这里**不**替代真验：合同「禁 mock 边清单」明写「必须真起进程验『拦在 listen 之前』，
 * 禁只单测自检函数——自检函数返回 false 但没人调它，单测照样绿」。那一层由
 * `structured-workbench-smoke.sh --a11-only` 真起第二个进程、断言 exit ∉ {0,124}
 * 且日志点名 A11-MULTI-ORG 来覆盖。
 *
 * 本文件只钉两件单测能钉住的事：查询本身的语义（多组织才算违规），
 * 以及"查不动"必须 fail-closed 而不是当成没问题。
 */
import { describe, it, expect } from 'vitest';
import {
  SELFCHECK_PASS_LOG,
  SELFCHECK_VIOLATION_TAG,
  SingleOrgSelfcheckError,
  findMultiOrgMembers,
  assertSingleOrgMembership,
} from './single-org-selfcheck';
import type { Pool } from 'pg';

/** 只替身"数据库返回了什么"这一层，被测的判定逻辑一行不变（不是 mock 成员表这条边本身） */
function poolReturning(rows: unknown[]): Pool {
  return { query: async () => ({ rows }) } as unknown as Pool;
}
function poolThatThrows(): Pool {
  return {
    query: async () => {
      throw new Error('connection refused');
    },
  } as unknown as Pool;
}

describe('A11 单组织自检', () => {
  it('日志标记与违规标签是两个不同的串（smoke 按它们分别 grep 正常态与违规态）', () => {
    expect(SELFCHECK_PASS_LOG).toBe('A11 single-org selfcheck passed');
    expect(SELFCHECK_VIOLATION_TAG).toBe('A11-MULTI-ORG');
    expect(SELFCHECK_PASS_LOG).not.toContain(SELFCHECK_VIOLATION_TAG);
  });

  it('无多组织行时通过', async () => {
    await expect(assertSingleOrgMembership(poolReturning([]))).resolves.toBeUndefined();
  });

  it('有多组织行时抛错，消息点名标签与冲突的 feishu_user_id', async () => {
    const pool = poolReturning([{ feishu_user_id: 'ou_dup_1', org_count: 2 }]);
    await expect(assertSingleOrgMembership(pool)).rejects.toThrow(SingleOrgSelfcheckError);
    await expect(assertSingleOrgMembership(pool)).rejects.toThrow(/A11-MULTI-ORG/);
    await expect(assertSingleOrgMembership(pool)).rejects.toThrow(/ou_dup_1/);
  });

  it('查不动成员表时放行，但**不打**通过标记 —— 那道闸这次没跑成，不许看起来像过了', async () => {
    const warns: string[] = [];
    const logs: string[] = [];
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = (m?: unknown) => void warns.push(String(m));
    console.log = (m?: unknown) => void logs.push(String(m));
    try {
      await expect(assertSingleOrgMembership(poolThatThrows())).resolves.toBeUndefined();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
    expect(warns.join('\n')).toContain('A11-SELFCHECK-UNAVAILABLE');
    // smoke 按 SELFCHECK_PASS_LOG grep 正常态，查不动时绝不能出现它
    expect(logs.join('\n')).not.toContain(SELFCHECK_PASS_LOG);
    expect(warns.join('\n')).not.toContain(SELFCHECK_VIOLATION_TAG);
  });

  it('findMultiOrgMembers 原样返回查询结果', async () => {
    const rows = [{ feishu_user_id: 'ou_x', org_count: 3 }];
    await expect(findMultiOrgMembers(poolReturning(rows))).resolves.toEqual(rows);
  });
});
