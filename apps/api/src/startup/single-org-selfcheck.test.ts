/**
 * A12 active_org 维度自检的判定形状（多组织切换第一刀：A11 单组织自检受控反转为 A12 维度自检）。
 *
 * 这里**不**替代真验：合同「禁 mock 边清单」明写「必须真起进程验『拦在 listen 之前』」。
 * 双向真验由 `org-context-switch-smoke.sh --a12-only` + 两个变异（改回多组织即退出 → 崩 /
 * no-op 新自检使维度缺失也放行 → 起）真起进程覆盖。
 *
 * 本文件只钉单测能钉住的判定语义：多组织合法（不再拒启动），但维度缺失时拒启动；查不动 fail-open。
 */
import { describe, it, expect } from 'vitest';
import {
  SELFCHECK_PASS_LOG,
  SELFCHECK_VIOLATION_TAG,
  ActiveOrgDimensionError,
  findMultiOrgMembers,
  hasActiveOrgColumn,
  assertActiveOrgDimensionReady,
} from './single-org-selfcheck';
import type { Pool } from 'pg';

/**
 * 按 SQL 内容分派的替身（只替身"库返回了什么"这一层，被测判定逻辑一行不变）：
 *   - tenant_members 查询 → 返回 multiOrgRows（多组织成员）
 *   - information_schema 查询 → hasColumn ? [{}] : []（维度是否部署）
 */
function poolDispatch(multiOrgRows: unknown[], hasColumn: boolean): Pool {
  return {
    query: async (sql: string) => {
      if (/information_schema/i.test(sql)) return { rows: hasColumn ? [{ one: 1 }] : [] };
      return { rows: multiOrgRows };
    },
  } as unknown as Pool;
}
function poolThatThrows(): Pool {
  return {
    query: async () => {
      throw new Error('connection refused');
    },
  } as unknown as Pool;
}

describe('A12 active_org 维度自检', () => {
  it('日志标记与违规标签是两个不同的串（smoke 按它们分别 grep 正常态与违规态）', () => {
    expect(SELFCHECK_PASS_LOG).toBe('A12 active-org dimension selfcheck passed');
    expect(SELFCHECK_VIOLATION_TAG).toBe('A12-DIMENSION-MISSING');
    expect(SELFCHECK_PASS_LOG).not.toContain(SELFCHECK_VIOLATION_TAG);
  });

  it('无多组织成员时通过（维度是否部署无关紧要）', async () => {
    await expect(assertActiveOrgDimensionReady(poolDispatch([], false))).resolves.toBeUndefined();
  });

  it('多组织成员合法存在 + 维度齐备 → 正常通过（不再像 A11 那样拒启动）', async () => {
    const pool = poolDispatch([{ feishu_user_id: 'ou_multi_1', org_count: 2 }], true);
    await expect(assertActiveOrgDimensionReady(pool)).resolves.toBeUndefined();
  });

  it('多组织成员存在 + 维度缺失 → 抛错，消息点名标签与冲突的 feishu_user_id', async () => {
    const pool = poolDispatch([{ feishu_user_id: 'ou_multi_1', org_count: 2 }], false);
    await expect(assertActiveOrgDimensionReady(pool)).rejects.toThrow(ActiveOrgDimensionError);
    await expect(assertActiveOrgDimensionReady(pool)).rejects.toThrow(/A12-DIMENSION-MISSING/);
    await expect(assertActiveOrgDimensionReady(pool)).rejects.toThrow(/ou_multi_1/);
  });

  it('查不动成员表时放行，但**不打**通过标记 —— 那道闸这次没跑成，不许看起来像过了（J9 fail-open）', async () => {
    const warns: string[] = [];
    const logs: string[] = [];
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = (m?: unknown) => void warns.push(String(m));
    console.log = (m?: unknown) => void logs.push(String(m));
    try {
      await expect(assertActiveOrgDimensionReady(poolThatThrows())).resolves.toBeUndefined();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
    expect(warns.join('\n')).toContain('A12-SELFCHECK-UNAVAILABLE');
    expect(logs.join('\n')).not.toContain(SELFCHECK_PASS_LOG);
    expect(warns.join('\n')).not.toContain(SELFCHECK_VIOLATION_TAG);
  });

  it('findMultiOrgMembers 原样返回查询结果', async () => {
    const rows = [{ feishu_user_id: 'ou_x', org_count: 3 }];
    await expect(findMultiOrgMembers(poolDispatch(rows, true))).resolves.toEqual(rows);
  });

  it('hasActiveOrgColumn 反映 information_schema 是否有 activeOrg 列', async () => {
    await expect(hasActiveOrgColumn(poolDispatch([], true))).resolves.toBe(true);
    await expect(hasActiveOrgColumn(poolDispatch([], false))).resolves.toBe(false);
  });
});
