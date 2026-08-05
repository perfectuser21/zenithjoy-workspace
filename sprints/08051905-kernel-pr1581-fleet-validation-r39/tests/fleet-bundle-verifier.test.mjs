import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFleetBundle } from '../fleet-bundle-verifier.mjs';

const valid = {
  schema_version: 1,
  execution_surface: 'fleet-worker',
  base_repo: 'perfectuser21/zenithjoy-workspace',
  base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  expected_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
  consumed_at: '2026-08-05T00:00:00.000Z',
  runner: { attempt_id: 'runtime-attempt', capability_snapshot_id: 'runtime-snapshot' },
};

test('真实 Fleet bundle 输出完整绑定结论', async () => {
  const result = await verifyFleetBundle(valid, { checkoutHead: valid.target_head_sha });
  assert.equal(result.ok, true);
  assert.equal(result.target_head_sha, valid.target_head_sha);
});

for (const [name, patch] of [
  ['缺失字段拒绝', { base_repo: undefined }],
  ['错误仓库拒绝', { base_repo: 'other/repo' }],
  ['非完整 target SHA 拒绝', { target_head_sha: 'c305f621' }],
  ['错 target SHA 拒绝', { target_head_sha: 'a'.repeat(40) }],
  ['错误 GP 拒绝', { gp_anchor: 'line02/keyword_acquisition#step8' }],
  ['bundle 与 checkout 不一致拒绝', { expected_head_sha: 'b'.repeat(40) }],
]) {
  test(name, async () => {
    await assert.rejects(verifyFleetBundle({ ...valid, ...patch }, { checkoutHead: valid.target_head_sha }), error => error.failure_class === 'payload_invalid');
  });
}
