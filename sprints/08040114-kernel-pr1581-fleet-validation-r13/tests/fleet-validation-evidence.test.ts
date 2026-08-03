import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sprintDir = 'sprints/08040114-kernel-pr1581-fleet-validation-r13';
const evidenceDir = process.env.HARNESS_EVIDENCE_DIR ?? join(sprintDir, 'evidence');
const gateBuilder = join(sprintDir, 'scripts/recompute-merge-gate.mjs');
const expected = {
  runId: 'a6e3ba3f-9856-4353-b05f-29f1049f7ca0',
  repo: 'perfectuser21/zenithjoy-workspace',
  pr: 1581,
  baseSha: '676fed7de12023d355deac7849af8a525ae53f8d',
  finalSha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
  runnerDigest: 'sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a',
};

type Json = Record<string, any>;

function readJson(name: string): Json {
  return JSON.parse(readFileSync(join(evidenceDir, name), 'utf8')) as Json;
}

function expectPipelineWindow(manifest: Json): { pipelineStarted: number; deadline: number } {
  const pipelineStarted = Date.parse(manifest.pipeline_started_at);
  const deadline = Date.parse(manifest.deadline_at);
  expect(Number.isFinite(pipelineStarted)).toBe(true);
  expect(Number.isFinite(deadline)).toBe(true);
  expect(deadline - pipelineStarted).toBe(7_200_000);
  return { pipelineStarted, deadline };
}

function expectFresh(name: string, manifest: Json, artifact: Json): void {
  const { pipelineStarted, deadline } = expectPipelineWindow(manifest);
  const attemptStarted = Date.parse(artifact.attempt_started_at);
  const producedAt = Date.parse(artifact.produced_at);
  expect(Number.isFinite(attemptStarted)).toBe(true);
  expect(Number.isFinite(producedAt)).toBe(true);
  expect(artifact.pipeline_started_at).toBe(manifest.pipeline_started_at);
  expect(artifact.deadline_at).toBe(manifest.deadline_at);
  expect(attemptStarted).toBeGreaterThanOrEqual(pipelineStarted);
  expect(attemptStarted).toBeLessThanOrEqual(deadline);
  expect(producedAt).toBeGreaterThanOrEqual(attemptStarted);
  expect(producedAt).toBeLessThanOrEqual(deadline);
  const mtime = statSync(join(evidenceDir, name)).mtimeMs;
  expect(mtime).toBeGreaterThanOrEqual(pipelineStarted);
  expect(mtime).toBeLessThanOrEqual(deadline);
}

function expectStableBinding(artifact: Json): void {
  expect(artifact.run_id).toBe(expected.runId);
  expect(artifact.repo).toBe(expected.repo);
  expect(artifact.pr_number).toBe(expected.pr);
  expect(artifact.final_sha).toBe(expected.finalSha);
  expect(typeof artifact.pipeline_started_at).toBe('string');
  expect(typeof artifact.deadline_at).toBe('string');
}

function expectRuntimeIdentity(artifact: Json): void {
  for (const key of ['attempt_id', 'provider', 'account', 'model', 'machine', 'capability_snapshot_id', 'runner_digest']) {
    expect(typeof artifact[key]).toBe('string');
    expect(artifact[key].length).toBeGreaterThan(0);
  }
  expect(artifact.machine).toBe('us-mac-m4');
  expect(artifact.runner_digest).toBe(expected.runnerDigest);
}

function expectSameRuntimeIdentity(actual: Json, source: Json): void {
  for (const key of ['attempt_id', 'provider', 'account', 'model', 'machine', 'capability_snapshot_id', 'runner_digest']) {
    expect(actual[key]).toBe(source[key]);
  }
}

function expectExecutableVerdict(artifact: Json): void {
  expect(artifact.exit_code).toBe(0);
  expect(typeof artifact.log_tail).toBe('string');
  expect(artifact.log_tail.length).toBeGreaterThan(0);
  expect(Array.isArray(artifact.behavior_tests)).toBe(true);
  expect(artifact.behavior_tests.length).toBeGreaterThanOrEqual(4);
  for (const behavior of artifact.behavior_tests) {
    expect(behavior.exit_code).toBe(0);
    expect(typeof behavior.log_tail).toBe('string');
    expect(behavior.log_tail.length).toBeGreaterThan(0);
  }
}

describe('PR #1581 real fleet validation evidence [BEHAVIOR]', () => {
  it('精确 PR HEAD 与冻结基线及获准 US M4 能力绑定', () => {
    const manifest = readJson('run-manifest.json');
    const remoteHead = execFileSync(
      'git',
      ['ls-remote', 'origin', 'refs/pull/1581/head'],
      { encoding: 'utf8' },
    ).trim().split(/\s+/)[0];

    expect(remoteHead).toBe(expected.finalSha);
    expect(execFileSync('git', ['merge-base', expected.baseSha, expected.finalSha], { encoding: 'utf8' }).trim())
      .toBe(expected.baseSha);
    expect(manifest).toMatchObject({
      run_id: expected.runId,
      repo: expected.repo,
      pr_number: expected.pr,
      frozen_base_sha: expected.baseSha,
      requested_final_sha: expected.finalSha,
      actual_final_sha: expected.finalSha,
      machine: 'us-mac-m4',
      runner_digest: expected.runnerDigest,
    });
    expectRuntimeIdentity(manifest);
    const { pipelineStarted, deadline } = expectPipelineWindow(manifest);
    const manifestMtime = statSync(join(evidenceDir, 'run-manifest.json')).mtimeMs;
    expect(Date.parse(manifest.attempt_started_at)).toBeGreaterThanOrEqual(pipelineStarted);
    expect(Date.parse(manifest.attempt_started_at)).toBeLessThanOrEqual(deadline);
    expect(manifestMtime).toBeGreaterThanOrEqual(pipelineStarted);
    expect(manifestMtime).toBeLessThanOrEqual(deadline);
  });

  it('Evaluator 裁决为本 attempt 新鲜 PASS 且绑定精确最终 SHA', () => {
    const manifest = readJson('run-manifest.json');
    const evaluator = readJson('evaluator-verdict.json');
    expectStableBinding(evaluator);
    expectRuntimeIdentity(evaluator);
    expectSameRuntimeIdentity(evaluator, manifest);
    expect(evaluator.verdict).toBe('PASS');
    expect(evaluator.role).toBe('evaluator');
    expectFresh('evaluator-verdict.json', manifest, evaluator);
    expectExecutableVerdict(evaluator);
  });

  it('Independent Judge 裁决独立新鲜 APPROVED 且绑定同一最终 SHA', () => {
    const manifest = readJson('run-manifest.json');
    const evaluator = readJson('evaluator-verdict.json');
    const judgeAttestation = readJson('judge-runner-attestation.json');
    const judge = readJson('independent-judge-verdict.json');
    expectStableBinding(judgeAttestation);
    expectRuntimeIdentity(judgeAttestation);
    expectStableBinding(judge);
    expectRuntimeIdentity(judge);
    expectSameRuntimeIdentity(judge, judgeAttestation);
    expect(judge.verdict).toBe('APPROVED');
    expect(judge.role).toBe('independent_judge');
    expect(judgeAttestation.role).toBe('independent_judge');
    const evaluatorSha256 = createHash('sha256')
      .update(readFileSync(join(evidenceDir, 'evaluator-verdict.json')))
      .digest('hex');
    expect(judge.evaluator_evidence_sha256).toBe(evaluatorSha256);
    expect(typeof evaluator.producer_execution_id).toBe('string');
    expect(typeof judge.producer_execution_id).toBe('string');
    expect(judge.producer_execution_id).not.toBe(evaluator.producer_execution_id);
    expect(judge.producer_execution_id).toBe(judgeAttestation.producer_execution_id);
    expect(judge.attempt_id).not.toBe(evaluator.attempt_id);
    expect(judge.evaluator_attempt_id).toBe(evaluator.attempt_id);
    expect(judge.evaluator_capability_snapshot_id).toBe(evaluator.capability_snapshot_id);
    expect(typeof judgeAttestation.attempt_started_at).toBe('string');
    expectFresh('judge-runner-attestation.json', manifest, judgeAttestation);
    expectFresh('independent-judge-verdict.json', manifest, judge);
    expectExecutableVerdict(judge);
  });

  it('机械合并门仅在双裁决新鲜且 SHA 一致时放行', () => {
    execFileSync('node', [gateBuilder, '--evidence-dir', evidenceDir], { encoding: 'utf8' });
    const manifest = readJson('run-manifest.json');
    const evaluator = readJson('evaluator-verdict.json');
    const judge = readJson('independent-judge-verdict.json');
    const gate = readJson('merge-gate.json');
    expectStableBinding(gate);
    expect(gate.merge_allowed).toBe(true);
    expect(gate.evaluator_verdict).toBe('PASS');
    expect(gate.judge_verdict).toBe('APPROVED');
    expect(gate.evaluator_final_sha).toBe(expected.finalSha);
    expect(gate.judge_final_sha).toBe(expected.finalSha);
    expect(gate.remote_pr_head).toBe(expected.finalSha);
    const { pipelineStarted, deadline } = expectPipelineWindow(manifest);
    expect(Date.parse(gate.remote_pr_head_checked_at)).toBeGreaterThanOrEqual(pipelineStarted);
    expect(Date.parse(gate.remote_pr_head_checked_at)).toBeLessThanOrEqual(deadline);
    expect(Date.now()).toBeLessThanOrEqual(deadline);
    expect(gate.reasons).toEqual([]);
    expect(gate.source_sha256).toMatchObject({
      run_manifest: expect.stringMatching(/^[0-9a-f]{64}$/),
      evaluator: expect.stringMatching(/^[0-9a-f]{64}$/),
      judge_runner_attestation: expect.stringMatching(/^[0-9a-f]{64}$/),
      independent_judge: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expectFresh('merge-gate.json', manifest, gate);
    expect(evaluator.final_sha).toBe(judge.final_sha);
  });

  it('机械合并门重算会拒绝 SHA 漂移且留下不可合并原因', () => {
    const result = spawnSync('node', [gateBuilder, '--evidence-dir', evidenceDir, '--self-test-sha-drift'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const diagnostic = JSON.parse(result.stdout.trim()) as Json;
    expect(diagnostic.merge_allowed).toBe(false);
    expect(diagnostic.reasons).toContain('judge_final_sha_mismatch');
  });

  it('机械合并门重算会拒绝门禁时远端 PR HEAD 漂移', () => {
    const result = spawnSync('node', [gateBuilder, '--evidence-dir', evidenceDir, '--self-test-remote-head-drift'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const diagnostic = JSON.parse(result.stdout.trim()) as Json;
    expect(diagnostic.merge_allowed).toBe(false);
    expect(diagnostic.reasons).toContain('remote_pr_head_mismatch');
  });

  it('机械合并门重算会拒绝全 run 共享截止时间超时', () => {
    const result = spawnSync('node', [gateBuilder, '--evidence-dir', evidenceDir, '--self-test-deadline-exceeded'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const diagnostic = JSON.parse(result.stdout.trim()) as Json;
    expect(diagnostic.merge_allowed).toBe(false);
    expect(diagnostic.reasons).toContain('pipeline_deadline_exceeded');
  });
});
