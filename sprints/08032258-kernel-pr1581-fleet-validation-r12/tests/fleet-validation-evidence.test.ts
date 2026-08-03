import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const evidenceDir = new URL('../evidence/', import.meta.url);
const runId = 'bfaf1e49-a8cb-401e-9fc3-d6c62c457edc';
const finalSha = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const requiredSnapshotId = 'cc3550be-875a-48d3-9be4-24343fb355a9';
const proposerAttemptId = '87d621ce-5d79-4cb6-bfa8-5ede64eb00c8';
const proposerSnapshotId = '3a09708c-cf4f-4ca9-9a23-526d57f7e162';
const execFileAsync = promisify(execFile);

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

async function validationIdentity(): Promise<Evidence> {
  return evidence('validation-identity.json');
}

function expectBoundToIdentity(item: Evidence, identity: Evidence): void {
  expect(item.run_id).toBe(identity.logical_run_id);
  expect(item.attempt_id).toBe(identity.validation_attempt_id);
  expect(item.final_sha).toBe(identity.final_sha);
}

async function githubPullRequest(): Promise<Evidence> {
  const { stdout } = await execFileAsync('gh', [
    'api', 'repos/perfectuser21/zenithjoy-workspace/pulls/1581',
  ]);
  return JSON.parse(stdout);
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
  it('唯一身份 SSOT 锁定验证 attempt 和执行面', async () => {
    const identity = await validationIdentity();
    const run = await evidence('fleet-run.json');
    expect(identity).toMatchObject({
      schema_version: 1,
      logical_run_id: runId,
      repository: 'perfectuser21/zenithjoy-workspace',
      pr_number: 1581,
      final_sha: finalSha,
      machine: 'us-mac-m4',
      provider: 'codex',
      account: 'team2',
      model: 'gpt-5.6-sol',
      capability_snapshot_id: requiredSnapshotId,
      runner_digest: 'sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a',
    });
    expect(identity.validation_attempt_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(identity.validation_attempt_id).not.toBe(proposerAttemptId);
    expect(identity.capability_snapshot_id).not.toBe(proposerSnapshotId);
    expectValidTimestamp(identity.created_at);
    expectBoundToIdentity(run, identity);
    expect(run.capability_snapshot_id).toBe(identity.capability_snapshot_id);
  });

  it('入口证据只引用身份 SSOT 并锁定仓库 PR 机器和最终 SHA', async () => {
    const [identity, run] = await Promise.all([validationIdentity(), evidence('fleet-run.json')]);
    expectBoundToIdentity(run, identity);
    expect(run).toMatchObject({
      repository: 'perfectuser21/zenithjoy-workspace',
      pr_number: 1581,
      final_sha: finalSha,
      machine: 'us-mac-m4',
      provider: 'codex',
      account: 'team2',
      model: 'gpt-5.6-sol',
      capability_snapshot_id: requiredSnapshotId,
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
    const [identity, run, evaluator] = await Promise.all([
      validationIdentity(), evidence('fleet-run.json'), evidence('evaluator.json'),
    ]);
    expectBoundToIdentity(evaluator, identity);
    expect(evaluator).toMatchObject({
      role: 'evaluator', verdict: 'PASS', exit_code: 0,
    });
    expect(typeof evaluator.evidence_id).toBe('string');
    expect(evaluator.evidence_id.length).toBeGreaterThan(0);
    expect(evaluator.source_product_validation_sha).toBe(finalSha);
    expect(expectValidTimestamp(evaluator.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(run.finished_at));
    expectCompleteBehaviorEvidence(evaluator.behavior_tests);
  });

  it('Independent Judge 新鲜独立 PASS 证据绑定 Evaluator 和最终 SHA', async () => {
    const [identity, evaluator, judge] = await Promise.all([
      validationIdentity(), evidence('evaluator.json'), evidence('independent-judge.json'),
    ]);
    expectBoundToIdentity(evaluator, identity);
    expectBoundToIdentity(judge, identity);
    expect(judge).toMatchObject({
      role: 'independent_judge', verdict: 'PASS', exit_code: 0,
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
    const [identity, run, evaluator, judge, gate, pull] = await Promise.all([
      validationIdentity(),
      evidence('fleet-run.json'), evidence('evaluator.json'),
      evidence('independent-judge.json'), evidence('merge-gate.json'),
      githubPullRequest(),
    ]);
    expectBoundToIdentity(gate, identity);
    expect(gate).toMatchObject({
      evaluator_evidence_id: evaluator.evidence_id,
      judge_evidence_id: judge.evidence_id,
      eligible_for_human_confirmation: true,
      human_confirmation_required: true,
      merge_performed: false,
    });
    expect(expectValidTimestamp(gate.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(judge.issued_at));
    expect(expectValidTimestamp(gate.issued_at)).toBeGreaterThanOrEqual(expectValidTimestamp(run.finished_at));
    expect(pull).toMatchObject({
      state: 'open',
      merged: false,
      merged_at: null,
      head: { sha: finalSha },
    });
  });
});
