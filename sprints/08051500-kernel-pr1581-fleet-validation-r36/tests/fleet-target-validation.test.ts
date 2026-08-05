import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const verifier = 'scripts/harness/verify-fleet-target.mjs';
const frozen = {
  base_repo: 'perfectuser21/zenithjoy-workspace',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
  base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
};

async function runCase(payload: Record<string, unknown>, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-target-contract-'));
  try {
    const payloadPath = join(dir, 'payload.json');
    const priorResultPath = join(dir, 'prior-result.json');
    const outputPath = join(dir, 'verdict.json');
    writeFileSync(payloadPath, JSON.stringify(payload));
    writeFileSync(priorResultPath, JSON.stringify({
      verdict: 'PASS', failure_class: null, failure_detail: null, target: frozen,
      evidence: { github_pr_head_sha: frozen.target_head_sha, checked_commit_sha: frozen.target_head_sha },
    }));
    const processResult = spawnSync(process.execPath, [verifier,
      '--payload', payloadPath, '--result', priorResultPath,
      '--product-map', 'product-map/generated/product-map.json', '--pr', '1581',
      '--db-url', process.env.DB_URL ?? 'postgresql://127.0.0.1:1/unreachable',
      '--output', outputPath, ...extraArgs], { encoding: 'utf8' });
    const verdict = JSON.parse(readFileSync(outputPath, 'utf8'));
    return { processResult, verdict };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Fleet 目标绑定 [BEHAVIOR]', () => {
  it('精确 payload 输出固定成功 schema', async () => {
    const { processResult, verdict } = await runCase(frozen);
    expect(processResult.status).toBe(0);
    expect(Object.keys(verdict).sort()).toEqual(['evidence', 'failure_class', 'failure_detail', 'target', 'verdict']);
    expect(verdict).toMatchObject({ verdict: 'PASS', failure_class: null, failure_detail: null, target: frozen });
  });

  it('字段缺失与格式错误输出 payload_invalid 和准确 field', async () => {
    for (const [payload, field] of [
      [{ ...frozen, base_repo: undefined }, 'base_repo'],
      [{ ...frozen, target_head_sha: 'short' }, 'target_head_sha'],
      [{ ...frozen, gp_anchor: undefined }, 'gp_anchor'],
    ] as const) {
      const { processResult, verdict } = await runCase(payload);
      expect(processResult.status).not.toBe(0);
      expect(verdict).toMatchObject({ verdict: 'FAIL', failure_class: 'payload_invalid', failure_detail: { field } });
      expect(verdict.failure_detail.reason).toBeTruthy();
    }
  });

  it('字段与冻结目标不一致输出 target_mismatch', async () => {
    for (const [payload, field] of [
      [{ ...frozen, base_repo: 'wrong/repo' }, 'base_repo'],
      [{ ...frozen, gp_anchor: 'line02/keyword_acquisition#step6' }, 'gp_anchor'],
    ] as const) {
      const { processResult, verdict } = await runCase(payload);
      expect(processResult.status).not.toBe(0);
      expect(verdict).toMatchObject({ verdict: 'FAIL', failure_class: 'target_mismatch', failure_detail: { field } });
    }
  });

  it('GitHub 拒绝连接输出 environment_failure github', async () => {
    const { processResult, verdict } = await runCase(frozen, ['--github-api-base', 'http://127.0.0.1:1']);
    expect(processResult.status).not.toBe(0);
    expect(verdict).toMatchObject({ verdict: 'FAIL', failure_class: 'environment_failure', failure_detail: { dependency: 'github' } });
  });

  it('Postgres 拒绝连接输出 environment_failure postgres', async () => {
    const { processResult, verdict } = await runCase(frozen, ['--db-url', 'postgresql://127.0.0.1:1/unreachable']);
    expect(processResult.status).not.toBe(0);
    expect(verdict).toMatchObject({ verdict: 'FAIL', failure_class: 'environment_failure', failure_detail: { dependency: 'postgres' } });
  });

  it('拒绝 GP 锚点不存在', async () => {
    const map = JSON.parse(readFileSync('product-map/generated/product-map.json', 'utf8'));
    expect(map.golden_paths.some((gp: { line_id: string; id: string; steps: { id: string }[] }) =>
      gp.line_id === 'line02' && gp.id === 'keyword_acquisition' && gp.steps.some(step => step.id === 'step7'))).toBe(true);
    const { processResult } = await runCase({ ...frozen, gp_anchor: 'line99/no_such_gp#step7' });
    expect(processResult.status).not.toBe(0);
  });
});
