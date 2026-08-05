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

async function runCase(payload: Record<string, unknown>, resultPatch = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-target-contract-'));
  try {
    const payloadPath = join(dir, 'payload.json');
    const resultPath = join(dir, 'result.json');
    writeFileSync(payloadPath, JSON.stringify(payload));
    writeFileSync(resultPath, JSON.stringify({
      verdict: 'PASS', failure_class: null, target: frozen,
      evidence: { github_pr_head_sha: frozen.target_head_sha, checked_commit_sha: frozen.target_head_sha },
      ...resultPatch,
    }));
    return spawnSync(process.execPath, [verifier, '--payload', payloadPath, '--result', resultPath,
      '--product-map', 'product-map/generated/product-map.json', '--pr', '1581'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Fleet 目标绑定 [BEHAVIOR]', () => {
  it('接受精确冻结目标并拒绝字段漂移', async () => {
    expect((await runCase(frozen)).status).toBe(0);
    for (const patch of [{ base_repo: 'wrong/repo' }, { target_head_sha: 'short' }, { gp_anchor: 'line02/keyword_acquisition#step6' }]) {
      expect((await runCase({ ...frozen, ...patch })).status).not.toBe(0);
    }
  });

  it('拒绝 result 证据 SHA 漂移', async () => {
    const run = await runCase(frozen, { evidence: { github_pr_head_sha: frozen.target_head_sha, checked_commit_sha: '0'.repeat(40) } });
    expect(run.status).not.toBe(0);
  });

  it('拒绝 GP 锚点不存在', async () => {
    const map = JSON.parse(readFileSync('product-map/generated/product-map.json', 'utf8'));
    expect(map.golden_paths.some((gp: { line_id: string; id: string; steps: { id: string }[] }) =>
      gp.line_id === 'line02' && gp.id === 'keyword_acquisition' && gp.steps.some(step => step.id === 'step7'))).toBe(true);
    expect((await runCase({ ...frozen, gp_anchor: 'line99/no_such_gp#step7' })).status).not.toBe(0);
  });
});

