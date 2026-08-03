import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const verifier = new URL('../verify-fleet-validation.mjs', import.meta.url);
const created: string[] = [];
const RUN = 'b3c74dad-0e21-4758-8a71-499c61d0736e';
const ATTEMPT = '711732ab-481a-4ab7-90ba-84c79f6403a3';
const SHA = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const SNAPSHOT = '20adc26e-4753-49f4-bfcf-1fcbceb155c2';
const roles = ['planner', 'contract_gan', 'generator', 'evaluator', 'independent_judge'] as const;

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function makeAuthority() {
  const root = await mkdtemp(join(tmpdir(), 'fleet-authority-'));
  created.push(root);
  await mkdir(join(root, 'receipts'));
  await mkdir(join(root, 'evidence'));
  await writeJson(join(root, 'dispatch.json'), {
    run_id: RUN, attempt_id: ATTEMPT, execution_surface: 'fleet-worker',
    repo: 'perfectuser21/zenithjoy-workspace', pr_number: 1581, target_sha: SHA,
    checkout_sha: SHA, issued_at: '2026-08-03T21:00:00.000Z', source: 'fleet-controller',
  });
  await writeJson(join(root, 'capability-snapshot.json'), {
    capability_snapshot_id: SNAPSHOT,
    to_target: { provider: 'codex', account: 'team2', model: 'gpt-5.6-sol', machine: 'us-mac-m4' },
    fallback_reason: 'preferred_target_healthy', failure_class: 'none', runner_version: '1.267.97', admitted: true,
  });
  for (const [index, role] of roles.entries()) {
    const receiptId = `receipt-${role}`;
    const evidence = {
      receipt_id: receiptId, role, run_id: RUN, attempt_id: ATTEMPT, target_sha: SHA,
      status: 'PASS', exit_code: 0, log_tail: `${role} completed`,
      behavior_tests: [{ name: role === 'generator' ? '.github/workflows/scripts/smoke/golden-path-2-smoke.sh' : `${role} oracle`, exit_code: 0, log_tail: 'fresh PASS' }],
    };
    const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
    const evidencePath = join(root, 'evidence', `${receiptId}.json`);
    await writeFile(evidencePath, bytes);
    await writeJson(join(root, 'receipts', `${role}.json`), {
      receipt_id: receiptId, role, run_id: RUN, attempt_id: ATTEMPT, target_sha: SHA,
      status: 'PASS', started_at: `2026-08-03T21:${String(index * 2).padStart(2, '0')}:00.000Z`,
      finished_at: `2026-08-03T21:${String(index * 2 + 1).padStart(2, '0')}:00.000Z`, exit_code: 0,
      evidence_path: `evidence/${receiptId}.json`, evidence_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  await writeJson(join(root, 'controller-audit.json'), {
    source: 'controller-audit', finalized: true, run_id: RUN, attempt_id: ATTEMPT,
    finalized_at: '2026-08-03T21:10:00.000Z',
    events: roles.map((role, index) => ({ occurred_at: `2026-08-03T21:${String(index * 2 + 1).padStart(2, '0')}:30.000Z`, actor: role, action: 'stage_receipt_recorded', target_sha: SHA })),
  });
  return root;
}

async function verify(root: string, check: string) {
  const module = await import(verifier.href);
  return module.verifyAuthority(await realpath(root), check);
}

describe('Kernel PR #1581 real Fleet authority contract', () => {
  it('拒绝非 US M4、版本漂移、Xian 或 SHA 漂移', async () => {
    const root = await makeAuthority();
    await expect(verify(root, 'affinity')).resolves.toBeUndefined();
    const snapshotPath = join(root, 'capability-snapshot.json');
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    snapshot.to_target.machine = 'xian-rog';
    await writeJson(snapshotPath, snapshot);
    await expect(verify(root, 'affinity')).rejects.toThrow(/machine|xian/i);
  });

  it('要求五阶段属于外部固定 run、attempt 和目标 SHA且证据可解引用', async () => {
    const root = await makeAuthority();
    await expect(verify(root, 'pipeline')).resolves.toBeUndefined();
    const receiptPath = join(root, 'receipts', 'generator.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.attempt_id = '58d80c43-70b7-4f4d-b291-4d844aa047c3';
    await writeJson(receiptPath, receipt);
    await expect(verify(root, 'pipeline')).rejects.toThrow(/attempt/i);
  });

  it('拒绝缺失、陈旧、时序逆转或复制的 Evaluator 与 Judge verdict', async () => {
    const root = await makeAuthority();
    await expect(verify(root, 'evaluator')).resolves.toBeUndefined();
    await expect(verify(root, 'judge')).resolves.toBeUndefined();
    const evaluator = JSON.parse(await readFile(join(root, 'receipts', 'evaluator.json'), 'utf8'));
    const judgePath = join(root, 'receipts', 'independent_judge.json');
    const judge = JSON.parse(await readFile(judgePath, 'utf8'));
    judge.receipt_id = evaluator.receipt_id;
    judge.evidence_path = evaluator.evidence_path;
    judge.evidence_sha256 = evaluator.evidence_sha256;
    judge.started_at = '2026-08-03T21:05:00.000Z';
    await writeJson(judgePath, judge);
    await expect(verify(root, 'judge')).rejects.toThrow(/independent|sequence|receipt|evidence/i);
  });

  it('只有权威双闸和 Controller 禁区审计全过才报告可合并且不执行合并', async () => {
    const root = await makeAuthority();
    await expect(verify(root, 'merge-gate')).resolves.toBeUndefined();
    const auditPath = join(root, 'controller-audit.json');
    const audit = JSON.parse(await readFile(auditPath, 'utf8'));
    audit.events.push({ occurred_at: '2026-08-03T21:06:30.000Z', actor: 'generator', action: 'other_candidate_read', target_sha: SHA });
    await writeJson(auditPath, audit);
    await expect(verify(root, 'merge-gate')).rejects.toThrow(/candidate|forbidden/i);
  });
});
