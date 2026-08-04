import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const evaluatorEntry = new URL('../scripts/evaluate-pr1581-evidence.mjs', import.meta.url);
const judgeEntry = new URL('../scripts/judge-pr1581-evidence.mjs', import.meta.url);
const dynamicId = (character: string): string => `${character.repeat(8)}-${character.repeat(4)}-4${character.repeat(3)}-8${character.repeat(3)}-${character.repeat(12)}`;
function behavior(name: string, exitCode = 0): Json {
  return { name, verification_level: 'L2', exit_code: exitCode, log_tail: `${name}:${exitCode}`, evidence: `${name}-evidence` };
}
function roleFixture(role: string, marker: string): Json {
  return {
    schema_version: 2, role, run_id: runId, logical_cycle_id: 'cycle-current',
    attempt_id: dynamicId(marker), final_sha: finalSha, provider: 'runner-provider',
    account: 'runner-account', machine: 'us-mac-m4', model: 'runner-model',
    runner_digest: `digest-${marker}`, capability_snapshot_id: dynamicId(marker === 'a' ? 'b' : 'c'),
    fleet_receipt_sha256: marker.repeat(64), exit_code: 0, log_tail: `${role}-ok`,
    behavior_tests: [behavior(`${role}-ok`)],
  };
}
async function writeJson(path: string, value: Json): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}
async function fileSha(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
async function runRejected(entry: URL, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    await execFileAsync(process.execPath, [entry.pathname, ...args], { cwd: process.cwd() });
  } catch (error: any) {
    expect(error.code).not.toBe(0);
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  throw new Error('生产入口对负向输入错误地返回 exit 0');
}
function expectIdentity(value: Json, role: string): void {
  expect(value).toMatchObject({ schema_version: 2, role, run_id: runId, final_sha: finalSha });
  expect(typeof value.logical_cycle_id).toBe('string');
  expect(value.logical_cycle_id.length).toBeGreaterThan(0);
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
function rolePassed(value: Json): boolean {
  return value.exit_code === 0 && Array.isArray(value.behavior_tests)
    && value.behavior_tests.length > 0 && value.behavior_tests.every((t: Json) => t.exit_code === 0);
}
function expectedEvaluatorVerdict(generator: Json, evaluator: Json): string {
  return rolePassed(generator) && rolePassed(evaluator) ? 'PASS' : 'FAIL';
}
function expectedJudgeVerdict(generator: Json, evaluator: Json): string {
  const missing = !generator || !evaluator || !Array.isArray(evaluator.behavior_tests);
  if (missing) return 'INSUFFICIENT_EVIDENCE';
  return rolePassed(generator) && rolePassed(evaluator) && evaluator.verdict === 'PASS' ? 'PASS' : 'FAIL';
}
async function expectRunnerReceipt(value: Json, role: string): Promise<void> {
  const receipt = await json(`${role}.fleet-receipt.json`);
  expect(receipt).toMatchObject({ schema_version: 1, issued_by: 'fleet-runner', role, run_id: runId });
  expect(receipt.logical_cycle_id).toBe(value.logical_cycle_id);
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
    expect(generator.actual_checkout_sha).toBe(finalSha);
    expect(generator.product_validation.migration).toMatchObject({ exit_code: 0 });
    expect(generator.product_validation.bootstrap).toMatchObject({ target_table_exists: true });
    expect(generator.product_validation.auth.signup_count).toBe(2);
    expect(generator.product_validation.auth.session_cookie_count).toBe(2);
    expect(generator.product_validation.auth.tenant_ids).toHaveLength(2);
    expect(generator.product_validation.auth.tenant_ids.every((id: unknown) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(generator.product_validation.auth.tenant_ids).size).toBe(2);
    expect(generator.product_validation.tenant_isolation).toMatchObject({ cross_tenant_leak_count: 0 });
    for (const name of ['checkout-head', 'migration', 'target-table-bootstrap', 'dynamic-signup-session-tenant', 'dual-tenant-isolation']) {
      expect(generator.behavior_tests).toContainEqual(expect.objectContaining({ name, verification_level: 'L2', exit_code: 0 }));
    }
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
    expect(evaluator.logical_cycle_id).toBe(generator.logical_cycle_id);
    expect(evaluator.upstream_provenance).toMatchObject({
      role: 'generator', attempt_id: generator.attempt_id,
      capability_snapshot_id: generator.capability_snapshot_id,
      evidence_sha256: await sha256('generator.json'),
    });
    expect(evaluator.attempt_id).not.toBe(generator.attempt_id);
    expect(evaluator.capability_snapshot_id).not.toBe(generator.capability_snapshot_id);
    expect(evaluator.verdict).toBe(expectedEvaluatorVerdict(generator, evaluator));
    const failedGeneratorBehavior = { ...generator, behavior_tests: generator.behavior_tests.map((test: Json, index: number) => index === 0 ? { ...test, exit_code: 9 } : test) };
    expect(expectedEvaluatorVerdict(failedGeneratorBehavior, evaluator)).toBe('FAIL');
  });

  it('Judge 引用 Evaluator 摘要并给出与证据一致的最终裁决', async () => {
    const [generator, evaluator, judge] = await Promise.all([
      json('generator.json'), json('evaluator.json'), json('judge.json'),
    ]);
    expectIdentity(judge, 'judge');
    expectCompleteEnvelope(judge);
    await expectRunnerReceipt(judge, 'judge');
    expect(judge.evaluator_evidence_sha256).toBe(await sha256('evaluator.json'));
    expect(judge.logical_cycle_id).toBe(evaluator.logical_cycle_id);
    expect(judge.upstream_provenance).toMatchObject({
      role: 'evaluator', attempt_id: evaluator.attempt_id,
      capability_snapshot_id: evaluator.capability_snapshot_id,
      evidence_sha256: await sha256('evaluator.json'),
    });
    expect(new Set([generator.attempt_id, evaluator.attempt_id, judge.attempt_id]).size).toBe(3);
    expect(new Set([generator.capability_snapshot_id, evaluator.capability_snapshot_id, judge.capability_snapshot_id]).size).toBe(3);
    expect(judge.verdict).toBe(expectedJudgeVerdict(generator, evaluator));
    const failedGeneratorBehavior = { ...generator, behavior_tests: generator.behavior_tests.map((test: Json, index: number) => index === 0 ? { ...test, exit_code: 9 } : test) };
    const failedEvaluatorBehavior = { ...evaluator, behavior_tests: evaluator.behavior_tests.map((test: Json, index: number) => index === 0 ? { ...test, exit_code: 9 } : test) };
    expect(expectedJudgeVerdict(failedGeneratorBehavior, evaluator)).toBe('FAIL');
    expect(expectedJudgeVerdict(generator, failedEvaluatorBehavior)).toBe('FAIL');
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

  it('同 run 和 SHA 的旧 attempt 重放必须被 provenance 拒绝', async () => {
    const [generator, evaluator, judge] = await Promise.all([json('generator.json'), json('evaluator.json'), json('judge.json')]);
    const evaluatorReplay = evaluator.behavior_tests.find((test: Json) => test.name === 'old-attempt-replay-rejected');
    const judgeReplay = judge.behavior_tests.find((test: Json) => test.name === 'old-attempt-replay-rejected');
    expect(evaluatorReplay).toMatchObject({ verification_level: 'L2', exit_code: 0 });
    expect(judgeReplay).toMatchObject({ verification_level: 'L2', exit_code: 0 });
    expect(evaluatorReplay.evidence).toContain('provenance mismatch');
    expect(judgeReplay.evidence).toContain('INSUFFICIENT_EVIDENCE');
    expect(evaluator.upstream_provenance.attempt_id).toBe(generator.attempt_id);
    expect(judge.upstream_provenance.attempt_id).toBe(evaluator.attempt_id);
  });

  it('Evaluator 生产入口拒绝旧 attempt 和失败 behavior', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr1581-evaluator-negative-'));
    try {
      const generatorPath = join(dir, 'generator.json');
      const resultPath = join(dir, 'result.json');
      const generator = roleFixture('generator', 'a');
      await writeJson(generatorPath, { ...generator, logical_cycle_id: 'cycle-old' });
      await runRejected(evaluatorEntry, [
        '--generator', generatorPath, '--logical-cycle-id', 'cycle-current',
        '--upstream-attempt-id', dynamicId('d'), '--upstream-capability-snapshot-id', dynamicId('e'),
        '--upstream-evidence-sha256', await fileSha(generatorPath), '--result', resultPath,
      ]);
      const replayResult = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(replayResult.verdict).toBe('FAIL');
      expect(replayResult.behavior_tests).toContainEqual(expect.objectContaining({ name: 'old-attempt-replay-rejected' }));
      expect(replayResult.behavior_tests.some((test: Json) => test.exit_code !== 0)).toBe(true);

      generator.logical_cycle_id = 'cycle-current';
      generator.behavior_tests = [behavior('forced-real-failure', 9)];
      await writeJson(generatorPath, generator);
      await runRejected(evaluatorEntry, [
        '--generator', generatorPath, '--logical-cycle-id', 'cycle-current',
        '--upstream-attempt-id', generator.attempt_id,
        '--upstream-capability-snapshot-id', generator.capability_snapshot_id,
        '--upstream-evidence-sha256', await fileSha(generatorPath), '--result', resultPath,
      ]);
      const failedResult = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(failedResult.verdict).toBe('FAIL');
      expect(failedResult.behavior_tests.some((test: Json) => test.exit_code !== 0)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Judge 生产入口拒绝旧 provenance、缺失证据和失败 behavior', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pr1581-judge-negative-'));
    try {
      const generatorPath = join(dir, 'generator.json');
      const evaluatorPath = join(dir, 'evaluator.json');
      const resultPath = join(dir, 'result.json');
      const generator = roleFixture('generator', 'a');
      await writeJson(generatorPath, generator);

      const staleEvaluator = { ...roleFixture('evaluator', 'd'), logical_cycle_id: 'cycle-old', verdict: 'PASS' };
      await writeJson(evaluatorPath, staleEvaluator);
      await runRejected(judgeEntry, [
        '--generator', generatorPath, '--evaluator', evaluatorPath,
        '--logical-cycle-id', 'cycle-current', '--upstream-attempt-id', dynamicId('e'),
        '--upstream-capability-snapshot-id', dynamicId('f'),
        '--upstream-evidence-sha256', await fileSha(evaluatorPath), '--result', resultPath,
      ]);
      const replayResult = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(replayResult.verdict).toBe('INSUFFICIENT_EVIDENCE');
      expect(replayResult.behavior_tests).toContainEqual(expect.objectContaining({ name: 'old-attempt-replay-rejected' }));
      expect(replayResult.behavior_tests.some((test: Json) => test.exit_code !== 0)).toBe(true);

      await rm(evaluatorPath);
      await runRejected(judgeEntry, [
        '--generator', generatorPath, '--evaluator', evaluatorPath,
        '--logical-cycle-id', 'cycle-current', '--upstream-attempt-id', dynamicId('d'),
        '--upstream-capability-snapshot-id', dynamicId('e'), '--upstream-evidence-sha256', '0'.repeat(64),
        '--result', resultPath,
      ]);
      const missingResult = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(missingResult.verdict).toBe('INSUFFICIENT_EVIDENCE');
      expect(missingResult.behavior_tests.some((test: Json) => test.exit_code !== 0)).toBe(true);

      const evaluator = { ...roleFixture('evaluator', 'd'), verdict: 'PASS' };
      evaluator.behavior_tests = [behavior('upstream-failure', 9)];
      await writeJson(evaluatorPath, evaluator);
      await runRejected(judgeEntry, [
        '--generator', generatorPath, '--evaluator', evaluatorPath,
        '--logical-cycle-id', 'cycle-current', '--upstream-attempt-id', evaluator.attempt_id,
        '--upstream-capability-snapshot-id', evaluator.capability_snapshot_id,
        '--upstream-evidence-sha256', await fileSha(evaluatorPath), '--result', resultPath,
      ]);
      const failedResult = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(failedResult.verdict).toBe('FAIL');
      expect(failedResult.behavior_tests.some((test: Json) => test.exit_code !== 0)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
