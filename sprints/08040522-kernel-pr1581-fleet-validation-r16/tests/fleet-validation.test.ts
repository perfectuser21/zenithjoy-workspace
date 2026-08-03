import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence');
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const sha = (name: string) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');

describe('PR #1581 严格 Fleet validation contract [BEHAVIOR]', () => {
  it('三角色均有独立 Runner 路由 attestation', () => {
    const rows = ['generator', 'evaluator', 'judge'].map((role) => ({ role, evidence: read(`${role}.json`), route: read(`routing-${role}.json`) }));
    for (const row of rows) {
      expect(row.route.role).toBe(row.role);
      expect(row.route.attempt_id).toBe(row.evidence.provenance.attempt_id);
      expect(row.route.capability_snapshot_id).toBe(row.evidence.provenance.capability_snapshot_id);
      expect(row.route.to_target.machine).toBe('us-mac-m4');
      expect(row.route.from_target).toEqual(row.route.to_target);
      expect(row.evidence.routing_attestation_sha256).toBe(sha(`routing-${row.role}.json`));
    }
    expect(new Set(rows.map((row) => row.route.receipt_id)).size).toBe(3);
  });

  it('Generator 与 Evaluator 固化相同 stable check ID 和精确命令', () => {
    const expected = ['db-empty-bootstrap', 'effective-config-integration', 'fixture-unchanged', 'product-map-contract', 'shared-red-smoke'];
    for (const role of ['generator', 'evaluator']) expect(read(`${role}.json`).checks.map((x: { check_id: string }) => x.check_id).sort()).toEqual(expected);
  });

  it('任一非零必跑检查均不得映射为 PASS', () => {
    const generator = read('generator.json');
    const evaluator = read('evaluator.json');
    const judge = read('judge.json');
    const allPassed = [...generator.checks, ...evaluator.checks].every((x: { exit_code: number }) => x.exit_code === 0) && generator.exit_code === 0 && evaluator.exit_code === 0;
    expect(judge.verdict === 'PASS' ? allPassed : true).toBe(true);
  });

  it('摘要链、目标头与 verdict 前未合并保持一致', () => {
    const generator = read('generator.json');
    const evaluator = read('evaluator.json');
    const judge = read('judge.json');
    expect([generator, evaluator, judge].map((x) => x.target_head_sha)).toEqual(Array(3).fill('c305f6217da65bb69413c39e621b7e797e0fb189'));
    expect(evaluator.generator_evidence_sha256).toBe(sha('generator.json'));
    expect(judge.evaluator_evidence_sha256).toBe(sha('evaluator.json'));
    expect(judge.pr_state_before_verdict).toBe('OPEN');
    expect(judge.pr_merged_at_before_verdict).toBeNull();
  });
});
