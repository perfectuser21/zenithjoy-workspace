import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const evidenceDir = join(process.cwd(), 'sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence');
const read = (name: string) => JSON.parse(readFileSync(join(evidenceDir, name), 'utf8'));
const digest = (name: string) => createHash('sha256').update(readFileSync(join(evidenceDir, name))).digest('hex');

describe('PR #1581 真实 Fleet 验证 [BEHAVIOR]', () => {
  it('严格 us-mac-m4 三角色证据链锚定同一目标头', () => {
    const generator = read('generator.json');
    const evaluator = read('evaluator.json');
    const judge = read('judge.json');
    const target = 'c305f6217da65bb69413c39e621b7e797e0fb189';
    expect([generator, evaluator, judge].map((item) => item.target_head_sha)).toEqual([target, target, target]);
    expect([generator, evaluator, judge].map((item) => item.provenance.machine)).toEqual(['us-mac-m4', 'us-mac-m4', 'us-mac-m4']);
    expect([generator, evaluator, judge].every((item) => item.routing.fallback_used === false)).toBe(true);
    expect(evaluator.generator_evidence_sha256).toBe(digest('generator.json'));
    expect(judge.evaluator_evidence_sha256).toBe(digest('evaluator.json'));
  });

  it('verdict 前保持未合并且失败不降级', () => {
    const judge = read('judge.json');
    expect(judge.pr_state_before_verdict).toBe('OPEN');
    expect(judge.pr_merged_at_before_verdict).toBeNull();
    expect(['PASS', 'FAIL', 'BLOCKED']).toContain(judge.verdict);
    expect(judge.behavior_tests.every((item: { exit_code: number; log_tail: string }) => Number.isInteger(item.exit_code) && typeof item.log_tail === 'string')).toBe(true);
  });

  it('角色 provenance 独立且时间顺序有效', () => {
    const manifest = read('run-manifest.json');
    const generator = read('generator.json');
    const evaluator = read('evaluator.json');
    const judge = read('judge.json');
    expect(new Set([generator.provenance.attempt_id, evaluator.provenance.attempt_id, judge.provenance.attempt_id]).size).toBe(3);
    const times = [manifest.started_at, generator.created_at, evaluator.created_at, judge.verdict_at].map(Date.parse);
    expect(times.every(Number.isFinite)).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[3] - times[0]).toBeLessThanOrEqual(7_200_000);
  });
});
