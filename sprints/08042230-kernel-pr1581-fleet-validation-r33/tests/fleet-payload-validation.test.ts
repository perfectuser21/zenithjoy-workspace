import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const sprintDir = path.resolve(__dirname, '..');
const validator = path.join(sprintDir, 'validate-fleet-payload.mjs');
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

  it('gp_anchor 不能唯一解析到 Step 7 时拒绝且不猜测', () => {
    expect(run({ ...valid, gp_anchor: 'line02/keyword_acquisition#step6' })).toMatchObject({ status: 1, body: { ok: false, failure_class: 'target_mismatch' } });
  });
});
