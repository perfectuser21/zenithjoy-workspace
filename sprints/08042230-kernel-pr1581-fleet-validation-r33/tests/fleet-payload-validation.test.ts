import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sprintDir = path.resolve(__dirname, '..');
const validator = path.join(sprintDir, 'validate-fleet-payload.mjs');
let evidenceDir = '';
let livePrJson = '';
const valid = {
  base_repo: 'perfectuser21/zenithjoy-workspace',
  base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
};

function run(payload: Record<string, unknown>) {
  const result = spawnSync(process.execPath, [validator, '--payload-json', JSON.stringify(payload), '--offline'], { encoding: 'utf8' });
  return { status: result.status, body: result.stdout ? JSON.parse(result.stdout) : null };
}

function runOnline(payload: Record<string, unknown>, prJson: string) {
  const result = spawnSync(process.execPath, [validator, '--payload-json', JSON.stringify(payload), '--pr-json', prJson, '--product-map', path.resolve(sprintDir, '../../product-map/generated/product-map.json')], { encoding: 'utf8' });
  return { status: result.status, body: result.stdout ? JSON.parse(result.stdout) : null };
}

beforeAll(() => {
  evidenceDir = mkdtempSync(path.join(tmpdir(), 'fleet-payload-test-'));
  livePrJson = path.join(evidenceDir, 'pr-1581.json');
  const response = spawnSync('curl', ['-fsSL', 'https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581'], { encoding: 'utf8' });
  if (response.status !== 0) throw new Error(`GitHub dependency unavailable: ${response.stderr}`);
  writeFileSync(livePrJson, response.stdout);
});

afterAll(() => {
  if (evidenceDir) rmSync(evidenceDir, { recursive: true, force: true });
});

describe('Fleet Worker payload 权威输入验证 [BEHAVIOR]', () => {
  it('正确 payload 原样绑定 base_repo、target_head_sha 与 gp_anchor', () => {
    expect(run(valid)).toMatchObject({ status: 0, body: { ok: true, ...valid, failure_class: 'none' } });
  });

  it('缺失 base_repo 时拒绝成功结论', () => {
    const { base_repo: _removed, ...payload } = valid;
    expect(run(payload)).toMatchObject({ status: 1, body: { ok: false, failure_class: 'payload_invalid' } });
  });

  it('target_head_sha 不是完整 SHA 时拒绝且不回退工作区 HEAD', () => {
    expect(run({ ...valid, target_head_sha: 'HEAD' })).toMatchObject({ status: 1, body: { ok: false, failure_class: 'payload_invalid' } });
  });

  it('target_head_sha 格式合法但与 PR head 不一致时拒绝', () => {
    expect(runOnline({ ...valid, target_head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, livePrJson)).toMatchObject({ status: 1, body: { ok: false, failure_class: 'target_mismatch' } });
  });

  it('缺失 gp_anchor 时拒绝成功结论', () => {
    const { gp_anchor: _removed, ...payload } = valid;
    expect(run(payload)).toMatchObject({ status: 1, body: { ok: false, failure_class: 'payload_invalid' } });
  });

  it('gp_anchor 不能唯一解析到 Step 7 时拒绝且不猜测', () => {
    expect(run({ ...valid, gp_anchor: 'line02/keyword_acquisition#step6' })).toMatchObject({ status: 1, body: { ok: false, failure_class: 'target_mismatch' } });
  });

  it('GitHub 依赖不可用时返回 environment_failure 且不误报业务通过', () => {
    expect(runOnline(valid, path.join(sprintDir, 'tests', 'fixtures', 'unavailable-pr.json'))).toMatchObject({ status: 1, body: { ok: false, failure_class: 'environment_failure' } });
  });
});
