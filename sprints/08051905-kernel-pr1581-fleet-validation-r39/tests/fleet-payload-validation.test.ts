import { describe, it, expect } from 'vitest';
import { validateFleetPayload } from '../validate-fleet-payload.mjs';

const expected = {
  base_repo: 'perfectuser21/zenithjoy-workspace',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
};
const evidence = {
  headRefOid: expected.target_head_sha,
  baseRefOid: '676fed7de12023d355deac7849af8a525ae53f8d',
};

describe('Fleet Worker payload 权威绑定 [BEHAVIOR]', () => {
  it('正确 payload 输出完整绑定结论', async () => {
    await expect(validateFleetPayload(expected, evidence)).resolves.toEqual({
      ok: true,
      ...expected,
      base_sha: evidence.baseRefOid,
      failure_class: null,
    });
  });

  it('缺失 base_repo 拒绝', async () => {
    const { base_repo: _, ...missing } = expected;
    await expect(validateFleetPayload(missing, evidence)).rejects.toMatchObject({ failure_class: 'payload_invalid' });
  });

  it('target_head_sha 不一致拒绝', async () => {
    await expect(validateFleetPayload({ ...expected, target_head_sha: evidence.baseRefOid }, evidence)).rejects.toMatchObject({ failure_class: 'payload_invalid' });
  });

  it('gp_anchor 不唯一拒绝', async () => {
    await expect(validateFleetPayload({ ...expected, gp_anchor: 'line02/keyword_acquisition#step07' }, evidence)).rejects.toMatchObject({ failure_class: 'payload_invalid' });
  });
});
