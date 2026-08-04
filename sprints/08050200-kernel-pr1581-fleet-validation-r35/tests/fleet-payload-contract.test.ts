import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const oracle = 'sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-oracle.sh';

describe('Fleet Worker payload 合同 [BEHAVIOR]', () => {
  it('拒绝缺失或篡改的权威 payload 字段', async () => {
    const bundle = process.env.HARNESS_TASK_BUNDLE_FILE;
    expect(bundle).toBeTruthy();
    const result = await execFileAsync('bash', [oracle, '--negative-matrix', bundle!]);
    expect(result.stdout.match(/^REJECTED:/gm)).toHaveLength(5);
  });

  it('审计回执绑定冻结目标与当前 validation identity', async () => {
    const receiptPath = process.env.RECEIPT_FILE;
    expect(receiptPath).toBeTruthy();
    const receipt = JSON.parse(await readFile(receiptPath!, 'utf8'));
    expect(receipt).toMatchObject({
      status: 'passed',
      failure_class: null,
      base_repo: 'perfectuser21/zenithjoy-workspace',
      base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
      target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
      gp_anchor: 'line02/keyword_acquisition#step7',
    });
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

