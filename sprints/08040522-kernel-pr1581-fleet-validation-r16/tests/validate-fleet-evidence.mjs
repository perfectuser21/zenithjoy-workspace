import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [evidenceDir, prJsonPath] = process.argv.slice(2);
if (!evidenceDir || !prJsonPath) throw new Error('用法: node validate-fleet-evidence.mjs <evidence-dir> <pr-json>');

const TARGET = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const RUN_ID = '5a037785-2708-489e-9912-b20494f11fd9';
const RUNNER_DIGEST = 'sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a';
const REQUIRED_CHECKS = new Map([
  ['product-map-contract', 'npm run product-map:check'],
  ['db-empty-bootstrap', 'DATABASE_URL="$DB_URL" npm run migrate --workspace=apps/api && psql "$DB_URL" -tAc "SELECT to_regclass(\'zenithjoy.acquisition_config\') IS NOT NULL" | grep -qx t'],
  ['effective-config-integration', 'DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose'],
  ['shared-red-smoke', "npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose"],
  ['fixture-unchanged', 'git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts'],
]);
const JUDGE_CHECK_IDS = ['routing-attestations', 'evidence-digest-chain', 'merge-order', 'failure-semantics'];
const REQUIRED_IDENTITY = ['attempt_id', 'provider', 'account', 'machine', 'model', 'runner_digest', 'capability_snapshot_id'];

const read = (name) => JSON.parse(readFileSync(join(evidenceDir, name), 'utf8'));
const digest = (name) => createHash('sha256').update(readFileSync(join(evidenceDir, name))).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const manifest = read('run-manifest.json');
const pr = JSON.parse(readFileSync(prJsonPath, 'utf8'));
const roles = Object.fromEntries(['generator', 'evaluator', 'judge'].map((role) => [role, read(`${role}.json`)]));
const attestations = Object.fromEntries(['generator', 'evaluator', 'judge'].map((role) => [role, read(`routing-${role}.json`)]));

assert(manifest.run_id === RUN_ID && manifest.target_head_sha === TARGET, 'run manifest 稳定对象错配');
assert(manifest.repo === 'perfectuser21/zenithjoy-workspace' && manifest.pr_number === 1581, 'run manifest repo/PR 错配');
assert(manifest.strict_machine === 'us-mac-m4' && manifest.runner_digest === RUNNER_DIGEST, 'run manifest Fleet 目标错配');
assert(pr.headRefOid === TARGET, 'GitHub PR head 已变化');

for (const role of ['generator', 'evaluator', 'judge']) {
  const evidence = roles[role];
  const attestation = attestations[role];
  assert(evidence.role === role && evidence.run_id === RUN_ID && evidence.target_head_sha === TARGET, `${role} 稳定对象错配`);
  for (const key of REQUIRED_IDENTITY) assert(typeof evidence.provenance?.[key] === 'string' && evidence.provenance[key], `${role} provenance.${key} 缺失`);
  assert(evidence.provenance.machine === 'us-mac-m4' && evidence.provenance.runner_digest === RUNNER_DIGEST, `${role} 执行目标错配`);
  assert(attestation.role === role && attestation.run_id === RUN_ID, `${role} routing attestation 对象错配`);
  assert(attestation.attempt_id === evidence.provenance.attempt_id, `${role} routing attempt 未绑定自身 evidence`);
  assert(attestation.capability_snapshot_id === evidence.provenance.capability_snapshot_id, `${role} routing capability 未绑定自身 evidence`);
  assert(attestation.to_target?.machine === 'us-mac-m4', `${role} routing 未到 us-mac-m4`);
  for (const key of ['provider', 'account', 'machine', 'model']) assert(attestation.from_target?.[key] === attestation.to_target?.[key], `${role} routing ${key} 发生降级`);
  assert(attestation.fallback_reason === 'preferred_target_healthy' && attestation.failure_class === 'none', `${role} routing 存在 fallback/failure`);
  assert(attestation.runner_digest === RUNNER_DIGEST, `${role} routing runner digest 错配`);
  assert(evidence.routing_attestation_sha256 === digest(`routing-${role}.json`), `${role} routing attestation 摘要错配`);
}

assert(new Set(Object.values(roles).map((e) => e.provenance.attempt_id)).size === 3, '三个角色 attempt 必须独立');
assert(new Set(Object.values(roles).map((e) => e.provenance.capability_snapshot_id)).size === 3, '三个角色 capability snapshot 必须独立');
assert(new Set(Object.values(attestations).map((e) => e.receipt_id)).size === 3, '三个角色 routing receipt 必须独立');

for (const role of ['generator', 'evaluator']) {
  const evidence = roles[role];
  assert(Number.isInteger(evidence.exit_code) && typeof evidence.log_tail === 'string', `${role} 顶层 exit_code/log_tail 缺失`);
  assert(Array.isArray(evidence.checks) && evidence.checks.length === REQUIRED_CHECKS.size, `${role} 必跑检查数量错配`);
  const seen = new Set();
  for (const check of evidence.checks) {
    assert(REQUIRED_CHECKS.has(check.check_id), `${role} 未知 check_id=${check.check_id}`);
    assert(!seen.has(check.check_id), `${role} 重复 check_id=${check.check_id}`);
    seen.add(check.check_id);
    assert(check.command === REQUIRED_CHECKS.get(check.check_id), `${role} check ${check.check_id} 命令漂移`);
    assert(Number.isInteger(check.exit_code) && typeof check.log_tail === 'string', `${role} check ${check.check_id} 缺 exit_code/log_tail`);
  }
}

assert(roles.evaluator.generator_evidence_sha256 === digest('generator.json'), 'Evaluator 引用 Generator 摘要错配');
assert(roles.judge.generator_evidence_sha256 === digest('generator.json'), 'Judge 引用 Generator 摘要错配');
assert(roles.judge.evaluator_evidence_sha256 === digest('evaluator.json'), 'Judge 引用 Evaluator 摘要错配');
assert(Number.isInteger(roles.judge.exit_code) && typeof roles.judge.log_tail === 'string', 'Judge 顶层 exit_code/log_tail 缺失');
assert(Array.isArray(roles.judge.behavior_tests), 'Judge behavior_tests 缺失');
assert(roles.judge.behavior_tests.map((x) => x.check_id).sort().join(',') === [...JUDGE_CHECK_IDS].sort().join(','), 'Judge stable check IDs 错配');
assert(roles.judge.behavior_tests.every((x) => Number.isInteger(x.exit_code) && typeof x.log_tail === 'string' && ['L2', 'L3'].includes(x.verification_level)), 'Judge 行为证据字段不完整');

const mandatory = [...roles.generator.checks, ...roles.evaluator.checks];
const allMandatoryPassed = mandatory.every((check) => check.exit_code === 0) && roles.generator.exit_code === 0 && roles.evaluator.exit_code === 0;
assert(['PASS', 'FAIL', 'BLOCKED'].includes(roles.judge.verdict), 'Judge verdict 非法');
assert(roles.judge.verdict !== 'PASS' || allMandatoryPassed, '非零必跑检查被错误映射为 PASS');
assert(roles.judge.verdict !== 'PASS' || roles.judge.behavior_tests.every((x) => x.exit_code === 0), '非零 Judge 行为被错误映射为 PASS');
assert(allMandatoryPassed || roles.judge.verdict !== 'PASS', '失败语义未 fail-closed');

const times = [manifest.started_at, roles.generator.created_at, roles.evaluator.created_at, roles.judge.verdict_at].map(Date.parse);
assert(times.every(Number.isFinite) && times.every((value, index) => index === 0 || value >= times[index - 1]), '证据时间顺序无效');
assert(times[3] - times[0] <= 7_200_000, '全链超过 7200 秒');
assert(roles.generator.pr_state_at_capture === 'OPEN' && roles.evaluator.pr_state_at_capture === 'OPEN', '角色 capture 时 PR 非 OPEN');
assert(roles.judge.pr_state_before_verdict === 'OPEN' && roles.judge.pr_merged_at_before_verdict === null, 'verdict 前 PR 已合并');
if (pr.mergedAt !== null) assert(Date.parse(pr.mergedAt) >= times[3], 'PR 在 verdict 前合并');

console.log(`OK: strict Fleet evidence verified verdict=${roles.judge.verdict} target=${TARGET}`);
