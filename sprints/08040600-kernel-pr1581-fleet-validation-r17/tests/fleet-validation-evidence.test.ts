import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const evidenceDir = new URL('../evidence/', import.meta.url);
const runId = '5172f36e-d86c-45cf-a417-b2678c2ec3e4';
const finalSha = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const execFileAsync = promisify(execFile);
type Json = Record<string, any>;

async function json(name: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(name, evidenceDir), 'utf8'));
}
async function sha256(name: string): Promise<string> {
  return createHash('sha256').update(await readFile(new URL(name, evidenceDir))).digest('hex');
}
function expectIdentity(value: Json, role: string): void {
  expect(value).toMatchObject({ schema_version: 2, role, run_id: runId, final_sha: finalSha });
  expect(value.attempt_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  for (const key of ['provider', 'account', 'machine', 'model', 'runner_digest', 'capability_snapshot_id']) {
    expect(typeof value[key]).toBe('string');
    expect(value[key]).not.toHaveLength(0);
  }
  expect(value.machine).toBe('us-mac-m4');
}
function expectCompleteEnvelope(value: Json): void {
  expect(Number.isInteger(value.exit_code)).toBe(true);
  expect(typeof value.log_tail).toBe('string');
  expect(value.log_tail.length).toBeGreaterThan(0);
  expect(Array.isArray(value.behavior_tests)).toBe(true);
  expect(value.behavior_tests.length).toBeGreaterThan(0);
  for (const test of value.behavior_tests) {
    expect(Number.isInteger(test.exit_code)).toBe(true);
    expect(typeof test.log_tail).toBe('string');
    expect(test.log_tail.length).toBeGreaterThan(0);
    expect(['L1', 'L2', 'L3']).toContain(test.verification_level);
    expect(typeof test.evidence).toBe('string');
    expect(test.evidence.length).toBeGreaterThan(0);
  }
}
function expectedEvaluatorVerdict(value: Json): string {
  return value.exit_code === 0 && value.behavior_tests.every((t: Json) => t.exit_code === 0) ? 'PASS' : 'FAIL';
}
function expectedJudgeVerdict(generator: Json, evaluator: Json): string {
  const missing = !generator || !evaluator || !Array.isArray(evaluator.behavior_tests);
  if (missing) return 'INSUFFICIENT_EVIDENCE';
  return generator.exit_code === 0 && evaluator.verdict === 'PASS' && evaluator.exit_code === 0
    && evaluator.behavior_tests.every((t: Json) => t.exit_code === 0) ? 'PASS' : 'FAIL';
}
async function expectRunnerReceipt(value: Json, role: string): Promise<void> {
  const receipt = await json(`${role}.fleet-receipt.json`);
  expect(receipt).toMatchObject({ schema_version: 1, issued_by: 'fleet-runner', role, run_id: runId });
  expect(receipt.issued_before_role_start).toBe(true);
  expect(receipt.receipt_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(value.fleet_receipt_sha256).toBe(await sha256(`${role}.fleet-receipt.json`));
  for (const key of ['attempt_id', 'provider', 'account', 'machine', 'model', 'runner_digest', 'capability_snapshot_id']) {
    expect(value[key]).toBe(receipt[key]);
  }
}

describe('PR #1581 fleet evidence chain [BEHAVIOR]', () => {
  it('Generator 新鲜证据绑定 Fleet 前置 receipt 和目标 SHA', async () => {
    const generator = await json('generator.json');
    expectIdentity(generator, 'generator');
    expectCompleteEnvelope(generator);
    await expectRunnerReceipt(generator, 'generator');
    expect(generator.repository).toBe('perfectuser21/zenithjoy-workspace');
    expect(generator.pr_number).toBe(1581);
    expect(generator.base_sha).toBe('676fed7de12023d355deac7849af8a525ae53f8d');
    expect(generator.product_validation.concurrent_effective_config).toMatchObject({
      response_statuses: [200, 400], invalid_error_code: 'INVALID_CONFIG',
    });
    expect(generator.product_validation.concurrent_effective_config.final_min)
      .toBeLessThanOrEqual(generator.product_validation.concurrent_effective_config.final_max);
    expect((await readFile(new URL('generator.receipt.sha256', evidenceDir), 'utf8')).trim())
      .toBe(await sha256('generator.json'));
  });

  it('Evaluator 保留失败证据并由 exit code 确定 verdict', async () => {
    const [generator, evaluator] = await Promise.all([json('generator.json'), json('evaluator.json')]);
    expectIdentity(evaluator, 'evaluator');
    expectCompleteEnvelope(evaluator);
    await expectRunnerReceipt(evaluator, 'evaluator');
    expect(evaluator.generator_receipt_sha256).toBe(await sha256('generator.json'));
    expect(evaluator.attempt_id).not.toBe(generator.attempt_id);
    expect(evaluator.capability_snapshot_id).not.toBe(generator.capability_snapshot_id);
    expect(evaluator.verdict).toBe(expectedEvaluatorVerdict(evaluator));
  });

  it('Judge 引用 Evaluator 摘要并给出与证据一致的最终裁决', async () => {
    const [generator, evaluator, judge] = await Promise.all([
      json('generator.json'), json('evaluator.json'), json('judge.json'),
    ]);
    expectIdentity(judge, 'judge');
    expectCompleteEnvelope(judge);
    await expectRunnerReceipt(judge, 'judge');
    expect(judge.evaluator_evidence_sha256).toBe(await sha256('evaluator.json'));
    expect(new Set([generator.attempt_id, evaluator.attempt_id, judge.attempt_id]).size).toBe(3);
    expect(new Set([generator.capability_snapshot_id, evaluator.capability_snapshot_id, judge.capability_snapshot_id]).size).toBe(3);
    expect(judge.verdict).toBe(expectedJudgeVerdict(generator, evaluator));
    const { stdout } = await execFileAsync('gh', ['api', 'repos/perfectuser21/zenithjoy-workspace/pulls/1581']);
    expect(JSON.parse(stdout)).toMatchObject({ state: 'open', merged: false, merged_at: null, head: { sha: finalSha } });
  });

  it('角色不得自行生成 Fleet receipt 且缺证不得判 PASS', async () => {
    for (const role of ['generator', 'evaluator', 'judge']) {
      const receipt = await json(`${role}.fleet-receipt.json`);
      expect(receipt.issued_by).toBe('fleet-runner');
      expect(receipt.issued_before_role_start).toBe(true);
    }
    const [generator, evaluator, judge] = await Promise.all([json('generator.json'), json('evaluator.json'), json('judge.json')]);
    expect(expectedJudgeVerdict(generator, { ...evaluator, exit_code: 1 })).toBe('FAIL');
    expect(expectedJudgeVerdict(generator, { ...evaluator, behavior_tests: undefined })).toBe('INSUFFICIENT_EVIDENCE');
    expect(judge.verdict).toBe(expectedJudgeVerdict(generator, evaluator));
  });
});
