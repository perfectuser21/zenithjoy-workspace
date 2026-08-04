import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const expected = {
  base_repo: 'perfectuser21/zenithjoy-workspace',
  base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
  target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  gp_anchor: 'line02/keyword_acquisition#step7',
};

describe('Fleet Worker payload 合同 [BEHAVIOR]', () => {
  it('拒绝缺失或篡改的权威 payload 字段', async () => {
    const validator = process.env.FLEET_VALIDATOR;
    const receipt = process.env.FLEET_VALIDATION_RECEIPT;
    const payload = process.env.HARNESS_TASK_PAYLOAD_JSON;
    expect(validator).toBeTruthy();
    expect(receipt).toBeTruthy();
    expect(payload).toBeTruthy();
    expect(() => execFileSync(validator!, ['--self-test-negative', payload!, receipt!], { stdio: 'pipe' })).not.toThrow();
  });

  it('审计回执绑定冻结目标与当前 validation identity', async () => {
    const path = process.env.FLEET_VALIDATION_RECEIPT;
    expect(path).toBeTruthy();
    const receipt = JSON.parse(await readFile(path!, 'utf8'));
    expect(receipt).toMatchObject({ status: 'passed', failure_class: null, ...expected });
    expect(receipt.validation_identity).toEqual({
      attempt_id: process.env.HARNESS_ATTEMPT_ID,
      provider: process.env.HARNESS_PROVIDER,
      account: process.env.HARNESS_ACCOUNT,
      machine: process.env.HARNESS_MACHINE,
      model: process.env.HARNESS_MODEL,
      runner_digest: process.env.HARNESS_RUNNER_DIGEST,
      capability_snapshot_id: process.env.CAPABILITY_SNAPSHOT_ID,
    });
  });
});
