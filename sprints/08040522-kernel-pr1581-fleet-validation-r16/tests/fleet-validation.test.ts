import { createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const evidenceDir = join(process.cwd(), 'sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence');
const raw = (name: string) => readFileSync(join(evidenceDir, name));
const read = (name: string) => JSON.parse(raw(name).toString('utf8'));
const sha = (name: string) => createHash('sha256').update(raw(name)).digest('hex');

describe('PR #1581 签名 Fleet validation contract [BEHAVIOR]', () => {
  it('三角色 Fleet start/completion attestation 签名有效且 dispatch 独立', () => {
    const publicKey = readFileSync(process.env.HARNESS_RUNNER_PUBLIC_KEY_PATH!);
    const dispatches = new Set<string>();
    for (const role of ['generator', 'evaluator', 'judge']) {
      for (const phase of ['start', 'complete']) {
        const body = raw(`runner-${phase}-${role}.json`);
        const signature = Buffer.from(raw(`runner-${phase}-${role}.sig`).toString('utf8').trim(), 'base64');
        expect(verify('sha256', body, publicKey, signature)).toBe(true);
      }
      const start = read(`runner-start-${role}.json`);
      const complete = read(`runner-complete-${role}.json`);
      expect(start.dispatch_id).toBe(complete.dispatch_id);
      expect(start.machine).toBe('us-mac-m4');
      expect(complete.observed_head_sha).toBe('c305f6217da65bb69413c39e621b7e797e0fb189');
      dispatches.add(start.dispatch_id);
    }
    expect(dispatches.size).toBe(3);
  });

  it('Generator 与 Evaluator 每项检查均记录在冻结目标 SHA 执行', () => {
    for (const role of ['generator', 'evaluator']) {
      const evidence = read(`${role}.json`);
      expect(evidence.checks.map((x: { check_id: string }) => x.check_id).sort()).toEqual([
        'checkout-head',
        'db-empty-bootstrap',
        'effective-config-integration',
        'product-map-contract',
        'shared-red-smoke',
      ]);
      expect(evidence.checks.every((x: { executed_head_sha: string }) => x.executed_head_sha === 'c305f6217da65bb69413c39e621b7e797e0fb189')).toBe(true);
      expect(read(`runner-complete-${role}.json`).checks).toEqual(evidence.checks);
    }
  });

  it('Fleet completion receipt 绑定各角色 evidence 现场摘要', () => {
    for (const role of ['generator', 'evaluator', 'judge']) {
      expect(read(`runner-complete-${role}.json`).evidence_sha256).toBe(sha(`${role}.json`));
    }
  });

  it('摘要链、fail-closed verdict 与 verdict 前未合并保持一致', () => {
    const generator = read('generator.json');
    const evaluator = read('evaluator.json');
    const judge = read('judge.json');
    expect(evaluator.generator_evidence_sha256).toBe(sha('generator.json'));
    expect(judge.generator_evidence_sha256).toBe(sha('generator.json'));
    expect(judge.evaluator_evidence_sha256).toBe(sha('evaluator.json'));
    const allPassed = [...generator.checks, ...evaluator.checks].every((x: { exit_code: number }) => x.exit_code === 0);
    expect(judge.verdict === 'PASS' ? allPassed : true).toBe(true);
    expect(judge.pr_state_before_verdict).toBe('OPEN');
    expect(judge.pr_merged_at_before_verdict).toBeNull();
  });
});
