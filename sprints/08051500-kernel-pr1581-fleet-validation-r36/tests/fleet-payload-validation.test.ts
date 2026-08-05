import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const verifier = 'sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs';

function invoke(bundle: string, workspace: string, env = process.env) {
  expect(existsSync(verifier), `TDD RED: 缺 ${verifier}`).toBe(true);
  return spawnSync(process.execPath, [verifier, '--bundle', bundle, '--workspace', workspace, '--base-sha', '676fed7de12023d355deac7849af8a525ae53f8d'], { env, encoding: 'utf8' });
}

describe('Fleet payload validation [BEHAVIOR]', () => {
  it('正确 payload 对账后通过', async () => {
    const result = invoke(process.env.FLEET_VALID_BUNDLE!, process.env.FLEET_TARGET_WORKTREE!);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'passed', base_repo: 'perfectuser21/zenithjoy-workspace', target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189', gp_anchor: 'line02/keyword_acquisition#step7' });
  });

  it('缺失字段 fail-closed', async () => {
    expect(existsSync(verifier), `TDD RED: 缺 ${verifier}`).toBe(true);
    const dir = mkdtempSync(`${tmpdir()}/fleet-r36-${process.pid}-`);
    try {
      const bundle = JSON.parse(readFileSync(process.env.FLEET_VALID_BUNDLE!, 'utf8'));
      delete bundle.inputs.payload.target_head_sha;
      writeFileSync(`${dir}/bundle.json`, JSON.stringify(bundle));
      const result = invoke(`${dir}/bundle.json`, process.env.FLEET_TARGET_WORKTREE!);
      expect(result.status).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', failure_class: 'payload_invalid', failed_field: 'target_head_sha' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('依赖故障分类', async () => {
    const result = invoke(process.env.FLEET_VALID_BUNDLE!, process.env.FLEET_TARGET_WORKTREE!, { ...process.env, GITHUB_API_URL: 'http://127.0.0.1:1' });
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', failure_class: 'environment_failure', failed_dependency: 'github' });
  });

  it('不回退当前 HEAD', async () => {
    const result = invoke(process.env.FLEET_VALID_BUNDLE!, process.env.FLEET_TARGET_WORKTREE!);
    expect(result.stdout).toContain('c305f6217da65bb69413c39e621b7e797e0fb189');
    expect(result.stdout).not.toContain('fd6bc889beaca3cd045080d408d37e3c5a2bcb48');
  });
});
