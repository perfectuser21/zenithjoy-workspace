import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const evidenceDir = new URL('../evidence/', import.meta.url);
const runId = '5172f36e-d86c-45cf-a417-b2678c2ec3e4';
const finalSha = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const execFileAsync = promisify(execFile);

type Evidence = Record<string, any>;

async function evidence(name: string): Promise<Evidence> {
  return JSON.parse(await readFile(new URL(name, evidenceDir), 'utf8'));
}

async function sha256(name: string): Promise<string> {
  const bytes = await readFile(new URL(name, evidenceDir));
  return createHash('sha256').update(bytes).digest('hex');
}

async function expectRunnerAttestation(item: Evidence, role: string): Promise<void> {
  const name = `${role}.runner-attestation.json`;
  const attestation = await evidence(name);
  expect(attestation).toMatchObject({ schema_version: 1, issued_by: 'fleet-runner', role });
  for (const key of ['attempt_id', 'provider', 'account', 'machine', 'model', 'runner_digest', 'capability_snapshot_id']) {
    expect(attestation[key]).toBe(item[key]);
  }
  expect(item.runner_attestation_sha256).toBe(await sha256(name));
}

function expectRuntimeIdentity(item: Evidence, role: string): void {
  expect(item.role).toBe(role);
  expect(item.run_id).toBe(runId);
  expect(item.final_sha).toBe(finalSha);
  expect(item.attempt_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  for (const key of ['provider', 'account', 'machine', 'model', 'runner_digest', 'capability_snapshot_id']) {
    expect(typeof item[key]).toBe('string');
    expect(item[key].length).toBeGreaterThan(0);
  }
  expect(item.machine).toBe('us-mac-m4');
}

function expectCompleteResult(item: Evidence): void {
  expect(item.exit_code).toBe(0);
  expect(typeof item.log_tail).toBe('string');
  expect(item.log_tail.length).toBeGreaterThan(0);
  expect(Array.isArray(item.behavior_tests)).toBe(true);
  expect(item.behavior_tests.length).toBeGreaterThan(0);
  for (const test of item.behavior_tests) {
    expect(test.exit_code).toBe(0);
    expect(typeof test.log_tail).toBe('string');
    expect(test.log_tail.length).toBeGreaterThan(0);
    expect(['L1', 'L2', 'L3']).toContain(test.verification_level);
    expect(typeof test.evidence).toBe('string');
    expect(test.evidence.length).toBeGreaterThan(0);
  }
}

function expectPairwiseDistinct(items: Evidence[], key: 'attempt_id' | 'capability_snapshot_id'): void {
  expect(new Set(items.map((item) => item[key])).size).toBe(items.length);
}

describe('PR #1581 fleet evidence chain [BEHAVIOR]', () => {
  it('Generator 新鲜证据绑定运行时身份和目标 SHA', async () => {
    const generator = await evidence('generator.json');
    expectRuntimeIdentity(generator, 'generator');
    await expectRunnerAttestation(generator, 'generator');
    expect(generator).toMatchObject({
      repository: 'perfectuser21/zenithjoy-workspace', pr_number: 1581,
      base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
      product_validation: { exit_code: 0 },
    });
    expect(typeof generator.product_validation.log_tail).toBe('string');
    expect(generator.product_validation.log_tail.length).toBeGreaterThan(0);
    expect(generator.product_validation.concurrent_effective_config).toMatchObject({
      response_statuses: [200, 400],
      invalid_error_code: 'INVALID_CONFIG',
    });
    expect(generator.product_validation.concurrent_effective_config.final_min)
      .toBeLessThanOrEqual(generator.product_validation.concurrent_effective_config.final_max);
    expect((await readFile(new URL('generator.receipt.sha256', evidenceDir), 'utf8')).trim()).toBe(await sha256('generator.json'));
  });

  it('Evaluator 使用自己的身份并引用 Generator receipt 摘要', async () => {
    const [generator, evaluator] = await Promise.all([evidence('generator.json'), evidence('evaluator.json')]);
    expectRuntimeIdentity(generator, 'generator');
    expectRuntimeIdentity(evaluator, 'evaluator');
    await expectRunnerAttestation(generator, 'generator');
    await expectRunnerAttestation(evaluator, 'evaluator');
    expect(evaluator.generator_receipt_sha256).toBe(await sha256('generator.json'));
    expectPairwiseDistinct([generator, evaluator], 'attempt_id');
    expectPairwiseDistinct([generator, evaluator], 'capability_snapshot_id');
    expect(evaluator.verdict).toBe('PASS');
    expectCompleteResult(evaluator);
  });

  it('Judge 使用自己的身份引用 Evaluator 摘要且裁决前未合并', async () => {
    const [generator, evaluator, judge] = await Promise.all([
      evidence('generator.json'), evidence('evaluator.json'), evidence('judge.json'),
    ]);
    expectRuntimeIdentity(generator, 'generator');
    expectRuntimeIdentity(evaluator, 'evaluator');
    expectRuntimeIdentity(judge, 'judge');
    await expectRunnerAttestation(generator, 'generator');
    await expectRunnerAttestation(evaluator, 'evaluator');
    await expectRunnerAttestation(judge, 'judge');
    expect(judge.evaluator_evidence_sha256).toBe(await sha256('evaluator.json'));
    expectPairwiseDistinct([generator, evaluator, judge], 'attempt_id');
    expectPairwiseDistinct([generator, evaluator, judge], 'capability_snapshot_id');
    expect(['PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE']).toContain(judge.verdict);
    expectCompleteResult(judge);
    const { stdout } = await execFileAsync('gh', ['api', 'repos/perfectuser21/zenithjoy-workspace/pulls/1581']);
    expect(JSON.parse(stdout)).toMatchObject({ state: 'open', merged: false, merged_at: null, head: { sha: finalSha } });
  });

  it('任一缺证或身份摘要漂移均不能判通过', async () => {
    const [generator, evaluator, judge] = await Promise.all([
      evidence('generator.json'), evidence('evaluator.json'), evidence('judge.json'),
    ]);
    expectRuntimeIdentity(generator, 'generator');
    expectRuntimeIdentity(evaluator, 'evaluator');
    expectRuntimeIdentity(judge, 'judge');
    await expectRunnerAttestation(generator, 'generator');
    await expectRunnerAttestation(evaluator, 'evaluator');
    await expectRunnerAttestation(judge, 'judge');
    expect(evaluator.generator_receipt_sha256).toBe(await sha256('generator.json'));
    expect(judge.evaluator_evidence_sha256).toBe(await sha256('evaluator.json'));
    expectPairwiseDistinct([generator, evaluator, judge], 'attempt_id');
    expectPairwiseDistinct([generator, evaluator, judge], 'capability_snapshot_id');
    expect(evaluator.verdict).toBe('PASS');
    expect(judge.verdict).toBe('PASS');
  });
});
