import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const worker = 'packages/brain/src/harness/fleet-worker.js';
const migration = 'packages/brain/migrations/20260804_create_harness_validation_receipts.sql';

function requireExecutionInputs() {
  if (!existsSync(worker)) throw new Error(`TDD RED: 缺生产 Fleet Worker ${worker}`);
  if (!existsSync(migration)) throw new Error(`TDD RED: 缺空库 migration ${migration}`);
  const bundle = process.env.FLEET_VALID_BUNDLE;
  const workspace = process.env.FLEET_TARGET_WORKTREE;
  if (!bundle || !workspace) throw new Error('缺 FLEET_VALID_BUNDLE/FLEET_TARGET_WORKTREE：测试禁止预制 receipt');
  return { bundle, workspace };
}

function dispatch(bundle: string, workspace: string, receipt: string, env = process.env) {
  return spawnSync(process.execPath, [worker, 'validate', '--bundle', bundle, '--workspace', workspace, '--receipt', receipt], { env, encoding: 'utf8' });
}

describe('Fleet Worker 真链路 receipt [BEHAVIOR]', () => {
  it('正确 payload 只有生产 Fleet Worker CLI 权威对账后通过', async () => {
    const { bundle, workspace } = requireExecutionInputs();
    const receipt = `${process.env.TMPDIR ?? '/tmp'}/fleet-${process.pid}-valid.json`;
    const run = dispatch(bundle, workspace, receipt);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ status: 'passed', base_repo: 'perfectuser21/zenithjoy-workspace', target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189', gp_anchor: 'line02/keyword_acquisition#step7' });
  });

  it('Runner provenance 在执行时绑定', async () => {
    const { bundle, workspace } = requireExecutionInputs();
    const receipt = `${process.env.TMPDIR ?? '/tmp'}/fleet-${process.pid}-identity.json`;
    expect(dispatch(bundle, workspace, receipt).status).toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8')).runner_provenance).toMatchObject({ attempt_id: process.env.HARNESS_ATTEMPT_ID, provider: process.env.HARNESS_PROVIDER, account: process.env.HARNESS_ACCOUNT, machine: process.env.HARNESS_MACHINE, model: process.env.HARNESS_MODEL, runner_digest: process.env.HARNESS_RUNNER_DIGEST, capability_snapshot_id: process.env.CAPABILITY_SNAPSHOT_ID });
  });

  it('product-map 缺失时生产 Fleet Worker L2 fail-closed', async () => {
    requireExecutionInputs();
    throw new Error('TDD RED: Generator 必须实现隔离 checkout 缺 product-map 的真实 CLI 集成测试');
  });

  it('格式合法但指向不存在 Step 的 gp_anchor 必须 fail-closed', async () => {
    const { bundle, workspace } = requireExecutionInputs();
    const dir = mkdtempSync(`${tmpdir()}/fleet-anchor-${process.pid}-`);
    try {
      const mutated = JSON.parse(readFileSync(bundle, 'utf8'));
      mutated.inputs.payload.gp_anchor = 'line02/keyword_acquisition#step999';
      const badBundle = `${dir}/bundle.json`;
      const receipt = `${dir}/receipt.json`;
      writeFileSync(badBundle, JSON.stringify(mutated));
      const run = dispatch(badBundle, workspace, receipt);
      expect(run.status, run.stderr).not.toBe(0);
      expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ status: 'failed', failure_class: 'target_mismatch', failed_field: 'gp_anchor' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
