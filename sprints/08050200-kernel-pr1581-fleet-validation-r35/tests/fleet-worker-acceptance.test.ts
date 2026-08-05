import { describe, expect, it } from 'vitest';
import { validateFleetPayload } from './fleet-worker-acceptance.mjs';

const validPayload = {
  base_repo: 'perfectuser21/zenithjoy-workspace',
  base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
};

describe('Fleet Worker payload acceptance [BEHAVIOR]', () => {
  it('从 Brain payload 读取三字段并绑定当前 receipt', async () => {
    const result = await validateFleetPayload(validPayload, {
      runId: 'runtime-run', attemptId: 'runtime-attempt', executionSurface: 'fleet-worker',
    });
    expect(result).toMatchObject({ status: 'passed', ...validPayload });
  });

  it.each([
    ['base_repo', undefined, 'base_repo_missing'],
    ['base_repo', 'wrong/repo', 'base_repo_mismatch'],
    ['target_head_sha', undefined, 'target_head_sha_missing'],
    ['target_head_sha', 'short', 'target_head_sha_invalid'],
    ['target_head_sha', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'target_head_sha_mismatch'],
    ['gp_anchor', undefined, 'gp_anchor_missing'],
    ['gp_anchor', 'line02/keyword_acquisition#step07', 'gp_anchor_invalid'],
  ])('缺失和篡改均精确失败且不回退: %s', async (field, value, failureClass) => {
    const payload = { ...validPayload, [field]: value };
    await expect(validateFleetPayload(payload, {
      runId: 'runtime-run', attemptId: 'runtime-attempt', executionSurface: 'fleet-worker',
    })).rejects.toMatchObject({ failure_class: failureClass });
  });

  it('空库 migration 后 schema 可验证', async () => {
    const result = await validateFleetPayload(validPayload, {
      runId: 'runtime-run', attemptId: 'runtime-attempt', executionSurface: 'fleet-worker', dbUrl: process.env.DB_URL,
    });
    expect(result.status).toBe('passed');
  });
});
