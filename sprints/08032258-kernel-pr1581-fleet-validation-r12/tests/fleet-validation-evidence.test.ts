import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const evidenceDir = new URL('../evidence/', import.meta.url);
const runId = 'bfaf1e49-a8cb-401e-9fc3-d6c62c457edc';
const attemptId = '5a73ee03-e897-4209-95b1-67c91f0f182a';
const finalSha = 'c305f6217da65bb69413c39e621b7e797e0fb189';

async function evidence(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(new URL(name, evidenceDir), 'utf8'));
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
    expect(run.product_validation?.exit_code).toBe(0);
  });

  it('Evaluator 新鲜 PASS 证据绑定本 attempt 和最终 SHA', async () => {
    const [run, verdict] = await Promise.all([evidence('fleet-run.json'), evidence('evaluator.json')]);
    expect(verdict).toMatchObject({ role: 'evaluator', verdict: 'PASS', exit_code: 0, run_id: runId, attempt_id: attemptId, final_sha: finalSha });
    expect(Date.parse(verdict.issued_at)).toBeGreaterThanOrEqual(Date.parse(run.started_at));
    expect(verdict.behavior_tests.length).toBeGreaterThan(0);
    expect(verdict.behavior_tests.every((item: any) => item.exit_code === 0 && typeof item.log_tail === 'string')).toBe(true);
  });

  it('Independent Judge 新鲜独立 PASS 证据绑定本 attempt 和最终 SHA', async () => {
    const [run, evaluator, judge] = await Promise.all([evidence('fleet-run.json'), evidence('evaluator.json'), evidence('independent-judge.json')]);
    expect(judge).toMatchObject({ role: 'independent_judge', verdict: 'PASS', exit_code: 0, run_id: runId, attempt_id: attemptId, final_sha: finalSha });
    expect(Date.parse(judge.issued_at)).toBeGreaterThanOrEqual(Date.parse(run.started_at));
    expect(judge.evidence_id).not.toBe(evaluator.evidence_id);
    expect(judge.behavior_tests.length).toBeGreaterThan(0);
    expect(judge.behavior_tests.every((item: any) => item.exit_code === 0 && typeof item.log_tail === 'string')).toBe(true);
  });

  it('双裁决齐备后仍只开放人工确认而未自动合并', async () => {
    const gate = await evidence('merge-gate.json');
    expect(gate).toMatchObject({ run_id: runId, attempt_id: attemptId, final_sha: finalSha, eligible_for_human_confirmation: true, human_confirmation_required: true, merge_performed: false });
    expect(gate.evaluator_evidence_id).toEqual(expect.any(String));
    expect(gate.judge_evidence_id).toEqual(expect.any(String));
  });
});
