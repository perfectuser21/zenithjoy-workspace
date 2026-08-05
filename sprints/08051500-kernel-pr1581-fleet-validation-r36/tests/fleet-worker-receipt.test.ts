import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const worker = 'packages/brain/src/harness/fleet-worker.js';
const migration = 'packages/brain/migrations/20260804_create_harness_validation_receipts.sql';

function inputs() {
  if (!existsSync(worker)) throw new Error(`TDD RED: 缺生产 Fleet Worker ${worker}`);
  if (!existsSync(migration)) throw new Error(`TDD RED: 缺真实 migration ${migration}`);
  if (!process.env.FLEET_VALID_BUNDLE || !process.env.FLEET_TARGET_WORKTREE) throw new Error('缺真实 Fleet bundle/worktree；禁止预制 receipt');
  return { bundle: process.env.FLEET_VALID_BUNDLE, workspace: process.env.FLEET_TARGET_WORKTREE };
}

function run(bundle: string, workspace: string, receipt: string, env = process.env) {
  return spawnSync(process.execPath, [worker, 'validate', '--bundle', bundle, '--workspace', workspace, '--receipt', receipt], { env, encoding: 'utf8' });
}

describe('Fleet Worker 真链路 receipt [BEHAVIOR]', () => {
  it('正确 payload 只有生产 Fleet Worker 权威对账后通过', async () => {
    const { bundle, workspace } = inputs();
    const receipt = `${tmpdir()}/fleet-${process.pid}-pass.json`;
    const result = run(bundle, workspace, receipt);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ status: 'passed', base_repo: 'perfectuser21/zenithjoy-workspace', target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189', gp_anchor: 'line02/keyword_acquisition#step7' });
  });

  it('字段变异经生产 Worker fail-closed', async () => {
    const { bundle, workspace } = inputs();
    const dir = mkdtempSync(`${tmpdir()}/fleet-mutation-${process.pid}-`);
    try {
      const payload = JSON.parse(readFileSync(bundle, 'utf8'));
      payload.inputs.payload.target_head_sha = 'HEAD';
      writeFileSync(`${dir}/bundle.json`, JSON.stringify(payload));
      const result = run(`${dir}/bundle.json`, workspace, `${dir}/receipt.json`);
      expect(result.status).not.toBe(0);
      expect(JSON.parse(readFileSync(`${dir}/receipt.json`, 'utf8'))).toMatchObject({ status: 'failed', failed_field: 'target_head_sha' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('依赖故障由 Worker 分类 environment_failure', async () => {
    const { bundle, workspace } = inputs();
    const receipt = `${tmpdir()}/fleet-${process.pid}-github-fail.json`;
    const result = run(bundle, workspace, receipt, { ...process.env, GITHUB_API_URL: 'http://127.0.0.1:1' });
    expect(result.status).not.toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ status: 'failed', failure_class: 'environment_failure', failed_dependency: 'github' });
  });

  it('Runner identity late-bound', async () => {
    const { bundle, workspace } = inputs();
    const receipt = `${tmpdir()}/fleet-${process.pid}-identity.json`;
    expect(run(bundle, workspace, receipt).status).toBe(0);
    expect(JSON.parse(readFileSync(receipt, 'utf8')).runner_provenance).toMatchObject({ attempt_id: process.env.HARNESS_ATTEMPT_ID, capability_snapshot_id: process.env.CAPABILITY_SNAPSHOT_ID });
  });
});

