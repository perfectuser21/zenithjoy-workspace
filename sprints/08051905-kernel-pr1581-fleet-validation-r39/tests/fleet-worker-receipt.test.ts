import { describe, it, expect } from 'vitest';
import { validateReceiptPayload, classifyDependencyFailure } from '../fleet-worker-receipt-check.mjs';

const valid = {
  base_repo: 'perfectuser21/zenithjoy-workspace',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
};

describe('Fleet Worker 真实 receipt 验收 [BEHAVIOR]', () => {
  it('真实 Fleet receipt 输出完整绑定结论', async () => {
    await expect(validateReceiptPayload(valid, valid)).resolves.toMatchObject({ ok: true, ...valid });
  });

  it.each([
    ['base_repo 缺失拒绝', { ...valid, base_repo: undefined }],
    ['base_repo 错值拒绝', { ...valid, base_repo: 'other/repo' }],
    ['target_head_sha 缺失拒绝', { ...valid, target_head_sha: undefined }],
    ['target_head_sha 非完整 SHA 拒绝', { ...valid, target_head_sha: 'c305f621' }],
    ['target_head_sha 错 head 拒绝', { ...valid, target_head_sha: 'a'.repeat(40) }],
    ['gp_anchor 缺失拒绝', { ...valid, gp_anchor: undefined }],
    ['gp_anchor 错值拒绝', { ...valid, gp_anchor: 'line02/keyword_acquisition#step8' }],
    ['gp_anchor 不唯一解析拒绝', { ...valid, gp_anchor: 'line02/keyword_acquisition#step07' }],
  ])('%s', async (_name, payload) => {
    await expect(validateReceiptPayload(payload, valid)).rejects.toMatchObject({ failure_class: 'payload_invalid' });
  });

  it.each(['brain', 'postgres', 'github'])('依赖不可用归 environment_failure: %s', async dependency => {
    expect(classifyDependencyFailure(dependency)).toEqual({ ok: false, failure_class: 'environment_failure', dependency });
  });
});

