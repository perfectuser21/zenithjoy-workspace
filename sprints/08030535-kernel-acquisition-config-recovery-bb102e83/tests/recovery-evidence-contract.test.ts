import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TARGET_SHA = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const evidenceDir = process.env.RECOVERY_EVIDENCE_DIR
  ?? join(import.meta.dirname, '..', 'evidence');

type BehaviorTest = {
  exit_code?: number;
  log_tail?: string;
  verification_level?: string;
};

type Verdict = {
  verdict?: string;
  exit_code?: number;
  log_tail?: string;
  anchor_sha?: string;
  behavior_tests?: BehaviorTest[];
  independent?: boolean;
  candidate_sources_read?: unknown[];
};

function load(name: string): Verdict {
  return JSON.parse(readFileSync(join(evidenceDir, name), 'utf8')) as Verdict;
}

function expectStructuredPass(result: Verdict): void {
  expect(result.verdict).toBe('PASS');
  expect(result.anchor_sha).toBe(TARGET_SHA);
  expect(result.exit_code).toBe(0);
  expect(typeof result.log_tail).toBe('string');
  expect(result.log_tail?.length).toBeGreaterThan(0);
  expect(Array.isArray(result.behavior_tests)).toBe(true);
  expect(result.behavior_tests?.length).toBeGreaterThan(0);
  for (const behavior of result.behavior_tests ?? []) {
    expect(behavior.exit_code).toBe(0);
    expect(typeof behavior.log_tail).toBe('string');
    expect(behavior.log_tail?.length).toBeGreaterThan(0);
  }
}

describe('Kernel recovery exact-SHA evidence contract [BEHAVIOR]', () => {
  it('Evaluator 结构化结论锚定目标 SHA 且行为证据全部通过', () => {
    expectStructuredPass(load('evaluator.json'));
  });

  it('Independent Judge 独立结论锚定同一目标 SHA 且未读取其他 candidate', () => {
    const judge = load('independent-judge.json');
    expectStructuredPass(judge);
    expect(judge.independent).toBe(true);
    expect(judge.candidate_sources_read).toEqual([]);
  });

  it('双结论一致后才产生精确 SHA 的可合并信号', () => {
    const evaluator = load('evaluator.json');
    const judge = load('independent-judge.json');
    const gate = JSON.parse(
      readFileSync(join(evidenceDir, 'merge-gate.json'), 'utf8'),
    ) as { merge_ready?: boolean; anchor_sha?: string; evaluator_sha?: string; judge_sha?: string };

    expectStructuredPass(evaluator);
    expectStructuredPass(judge);
    expect(gate).toEqual({
      merge_ready: true,
      anchor_sha: TARGET_SHA,
      evaluator_sha: TARGET_SHA,
      judge_sha: TARGET_SHA,
    });
  });
});
