import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function receipt(): any {
  const path = process.env.HARNESS_FLEET_RECEIPT_PATH;
  if (!path) throw new Error('HARNESS_FLEET_RECEIPT_PATH 缺失：禁止 fixture/旁路 CLI 替代真实 Fleet receipt');
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Fleet Worker 真链路 receipt [BEHAVIOR]', () => {
  it('正确 payload 只有权威对账后通过', async () => {
    const r = receipt();
    expect(r).toMatchObject({ status: 'passed', base_repo: 'perfectuser21/zenithjoy-workspace', base_sha: '676fed7de12023d355deac7849af8a525ae53f8d', target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189', gp_anchor: 'line02/keyword_acquisition#step7', failure_class: 'none' });
    expect(r.checks.every((c: any) => c.status === 'passed' && c.skipped !== true)).toBe(true);
  });

  it('九项 PRD 变异全部失败', async () => {
    const expected = ['github_unavailable', 'gp_anchor_ambiguous', 'gp_anchor_missing', 'postgres_unavailable', 'repo_missing', 'repo_wrong', 'target_head_mismatch', 'target_head_missing', 'target_head_short'];
    const failed = receipt().mutation_receipts.filter((x: any) => x.status === 'failed' && x.failure_class !== 'none').map((x: any) => x.case);
    expect([...new Set(failed)].sort()).toEqual(expected);
  });

  it('Runner provenance 在执行时绑定', async () => {
    expect(receipt().runner_provenance).toMatchObject({ attempt_id: process.env.HARNESS_ATTEMPT_ID, capability_snapshot_id: process.env.CAPABILITY_SNAPSHOT_ID });
  });
});
