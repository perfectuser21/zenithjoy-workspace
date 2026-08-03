import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';

const sprintDir = new URL('../', import.meta.url);
const verifier = new URL('../verify-fleet-validation.mjs', import.meta.url);
const report = new URL('../fleet-validation-report.json', import.meta.url);

async function loadDelivery() {
  await access(verifier);
  const parsed = JSON.parse(await readFile(report, 'utf8'));
  return parsed;
}

async function verify(value: unknown, check: string) {
  const module = await import(verifier.href);
  return module.verifyReport(value, check);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('Kernel PR #1581 real Fleet validation contract', () => {
  it('拒绝非 US M4、版本漂移、Xian 或 SHA 漂移', async () => {
    const value = await loadDelivery();
    await expect(verify(value, 'affinity')).resolves.toBeUndefined();
    expect(value.runner).toMatchObject({ machine: 'us-mac-m4', version: '1.267.97', admitted: true, fallback_used: false, xian_used: false });
    expect(new Set([value.target.expected_sha, value.target.observed_pr_head_sha, value.target.checkout_sha])).toEqual(new Set(['c305f6217da65bb69413c39e621b7e797e0fb189']));
    for (const mutation of [
      (copy: any) => { copy.runner.machine = 'xian-rog'; },
      (copy: any) => { copy.runner.version = '1.267.96'; },
      (copy: any) => { copy.runner.xian_used = true; },
      (copy: any) => { copy.target.checkout_sha = '0'.repeat(40); },
    ]) {
      const bad = clone(value); mutation(bad);
      await expect(verify(bad, 'affinity')).rejects.toThrow();
    }
  });

  it('要求五阶段属于同一 run、attempt 和目标 SHA', async () => {
    const value = await loadDelivery();
    await expect(verify(value, 'pipeline')).resolves.toBeUndefined();
    expect(value.pipeline.stages.map((stage: { name: string }) => stage.name).sort()).toEqual(['contract_gan', 'evaluator', 'generator', 'independent_judge', 'planner']);
    for (const stage of value.pipeline.stages) expect(stage).toMatchObject({ status: 'PASS', run_id: value.run_id, attempt_id: value.attempt_id, target_sha: value.target.expected_sha });
    const missingCallbackStage = clone(value);
    missingCallbackStage.pipeline.stages = missingCallbackStage.pipeline.stages.filter((stage: { name: string }) => stage.name !== 'contract_gan');
    await expect(verify(missingCallbackStage, 'pipeline')).rejects.toThrow();
  });

  it('拒绝缺失、陈旧或复制的 Evaluator 与 Judge verdict', async () => {
    const value = await loadDelivery();
    await expect(verify(value, 'evaluator')).resolves.toBeUndefined();
    await expect(verify(value, 'judge')).resolves.toBeUndefined();
    expect(value.evaluator).toMatchObject({ status: 'PASS', fresh: true, exit_code: 0, run_id: value.run_id, attempt_id: value.attempt_id, target_sha: value.target.expected_sha });
    expect(value.independent_judge).toMatchObject({ status: 'PASS', fresh: true, exit_code: 0, run_id: value.run_id, attempt_id: value.attempt_id, target_sha: value.target.expected_sha });
    expect(value.evaluator.evidence_uri).not.toBe(value.independent_judge.evidence_uri);
    const copied = clone(value);
    copied.independent_judge.evidence_uri = copied.evaluator.evidence_uri;
    await expect(verify(copied, 'judge')).rejects.toThrow();
    const stale = clone(value);
    stale.evaluator.run_id = 'historical-run';
    await expect(verify(stale, 'evaluator')).rejects.toThrow();
  });

  it('只有双闸和禁区核对全过才报告可合并且不执行合并', async () => {
    const value = await loadDelivery();
    await expect(verify(value, 'merge-gate')).resolves.toBeUndefined();
    expect(value.forbidden_checks).toEqual({ other_candidate_read: false, shared_red_fixture_modified: false, merged_before_blind_verdict: false });
    expect(value.merge).toEqual({ allowed: true, merged: false, reason: 'evaluator_and_independent_judge_passed' });
    const forbidden = clone(value);
    forbidden.forbidden_checks.other_candidate_read = true;
    await expect(verify(forbidden, 'merge-gate')).rejects.toThrow();
    const merged = clone(value);
    merged.merge.merged = true;
    await expect(verify(merged, 'merge-gate')).rejects.toThrow();
  });
});
