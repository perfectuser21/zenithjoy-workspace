import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const evidenceDir = new URL('../evidence/', import.meta.url);
const runId = 'bfaf1e49-a8cb-401e-9fc3-d6c62c457edc';
const attemptId = 'ebb6a784-ff4b-425b-ba08-d5d8625e2736';
const finalSha = 'c305f6217da65bb69413c39e621b7e797e0fb189';

type BehaviorEvidence = {
  exit_code: number;
  log_tail: string;
  verification_level: 'L1' | 'L2' | 'L3';
  evidence: string;
};

type Evidence = Record<string, any>;

async function evidence(name: string): Promise<Evidence> {
  return JSON.parse(await readFile(new URL(name, evidenceDir), 'utf8'));
}

function expectValidTimestamp(value: unknown): number {
  expect(typeof value).toBe('string');
  const timestamp = Date.parse(value as string);
  expect(Number.isFinite(timestamp)).toBe(true);
  return timestamp;
}

function expectCompleteBehaviorEvidence(items: unknown): void {
  expect(Array.isArray(items)).toBe(true);
  expect((items as BehaviorEvidence[]).length).toBeGreaterThan(0);
  for (const item of items as BehaviorEvidence[]) {
    expect(item.exit_code).toBe(0);
    expect(typeof item.log_tail).toBe('string');
    expect(item.log_tail.length).toBeGreaterThan(0);
    expect(['L1', 'L2', 'L3']).toContain(item.verification_level);
    expect(typeof item.evidence).toBe('string');
    expect(item.evidence.length).toBeGreaterThan(0);
  }
}

describe('PR #1581 真实 fleet 双裁决证据 [BEHAVIOR]', () => {
  it('入口证据锁定仓库 PR 机器和精确最终 SHA', async () => {
    const run = await evidence('fleet-run.json');
    expect(run).toMatchObject({
      run_id: runId,
      attempt_id: attemptId,
      repository: 'perfectuser21/zenithjoy-workspace',
      pr_number: 1581,
      final_sha: finalSha,
      machine: 'us-mac-m4',
      provider: 'codex',
      account: 'team2',
      model: 'gpt-5.6-sol',
      capability_snapshot_id: 'cc3550be-875a-48d3-9be4-24343fb355a9',
      runner_digest: 'sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a',
      pipeline_status: 'passed',
    });
    expect(run.product_validation).toMatchObject({ exit_code: 0, final_sha: finalSha });
    expect(typeof run.product_validation.log_tail).toBe('string');
    expect(run.product_validation.log_tail.length).toBeGreaterThan(0);
    const started = expectValidTimestamp(run.started_at);
    const finished = expectValidTimestamp(run.finished_at);
    expect(finished).toBeGreaterThanOrEqual(started);
    expect(finished - started).toBeLessThanOrEqual(7_200_000);
  });

  it('Evaluator 新鲜 PASS 证据绑定本 attempt 和最终 SHA', async () => {
    const [run, evaluator] = await Promise.all([evidence('fleet-run.json'), evidence('evaluator.json')]);
    expect(evaluator).toMatchObject({
      role: 'evaluator', verdict: 'PASS', exit_code: 0,
      run_id: runId, attempt_id: attemptId, final_sha: finalSha,
    });
    expect(typeof evaluator.evidence_id).toBe('string');
    expect(evaluator.evidence_id.length).toBeGreaterThan(0);
    expect(evaluator.source_product_validation_sha).toBe(finalSha);
    expect(expectValidTimestamp(evaluator.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(run.finished_at));
    expectCompleteBehaviorEvidence(evaluator.behavior_tests);
  });

  it('Independent Judge 新鲜独立 PASS 证据绑定 Evaluator 和最终 SHA', async () => {
    const [evaluator, judge] = await Promise.all([evidence('evaluator.json'), evidence('independent-judge.json')]);
    expect(judge).toMatchObject({
      role: 'independent_judge', verdict: 'PASS', exit_code: 0,
      run_id: runId, attempt_id: attemptId, final_sha: finalSha,
      evaluated_evidence_id: evaluator.evidence_id,
      evaluated_sha: evaluator.final_sha,
    });
    expect(typeof judge.evidence_id).toBe('string');
    expect(judge.evidence_id.length).toBeGreaterThan(0);
    expect(judge.evidence_id).not.toBe(evaluator.evidence_id);
    expect(expectValidTimestamp(judge.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(evaluator.issued_at));
    expectCompleteBehaviorEvidence(judge.behavior_tests);
  });

  it('双裁决齐备后仍只开放人工确认而未自动合并', async () => {
    const [run, evaluator, judge, gate] = await Promise.all([
      evidence('fleet-run.json'), evidence('evaluator.json'),
      evidence('independent-judge.json'), evidence('merge-gate.json'),
    ]);
    expect(gate).toMatchObject({
      run_id: runId,
      attempt_id: attemptId,
      final_sha: finalSha,
      evaluator_evidence_id: evaluator.evidence_id,
      judge_evidence_id: judge.evidence_id,
      eligible_for_human_confirmation: true,
      human_confirmation_required: true,
      merge_performed: false,
    });
    expect(expectValidTimestamp(gate.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(judge.issued_at));
    expect(expectValidTimestamp(gate.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(run.finished_at));
  });
});
