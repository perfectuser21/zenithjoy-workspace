import { createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [evidenceDir, prJsonPath, runnerPublicKeyPath] = process.argv.slice(2);
if (!evidenceDir || !prJsonPath || !runnerPublicKeyPath) {
  throw new Error('用法: node validate-fleet-evidence.mjs <evidence-dir> <pr-json> <runner-public-key.pem>');
}

const TARGET = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const RUN_ID = '5a037785-2708-489e-9912-b20494f11fd9';
const RUNNER_DIGEST = 'sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a';
const REQUIRED_CHECKS = new Map([
  ['checkout-head', 'git rev-parse HEAD'],
  ['product-map-contract', 'npm run product-map:check'],
  ['db-empty-bootstrap', 'DATABASE_URL="$DB_URL" npm run migrate --workspace=apps/api && psql "$DB_URL" -tAc "SELECT to_regclass(\'zenithjoy.acquisition_config\') IS NOT NULL" | grep -qx t'],
  ['effective-config-integration', 'DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose'],
  ['shared-red-smoke', "git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts && npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose"],
]);
const JUDGE_CHECK_IDS = ['runner-signatures', 'evidence-digest-chain', 'merge-order', 'failure-semantics'];

const raw = (name) => readFileSync(join(evidenceDir, name));
const read = (name) => JSON.parse(raw(name));
const digest = (name) => createHash('sha256').update(raw(name)).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const parseTime = (value, label) => {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} 时间无效`);
  return parsed;
};
const publicKey = readFileSync(runnerPublicKeyPath);
const verifySigned = (name) => {
  const body = raw(`${name}.json`);
  const signature = Buffer.from(readFileSync(join(evidenceDir, `${name}.sig`), 'utf8').trim(), 'base64');
  assert(verify('sha256', body, publicKey, signature), `${name} Fleet 签名无效`);
  return JSON.parse(body);
};

const manifest = read('run-manifest.json');
const pr = JSON.parse(readFileSync(prJsonPath, 'utf8'));
const roles = Object.fromEntries(['generator', 'evaluator', 'judge'].map((role) => [role, read(`${role}.json`)]));
const starts = Object.fromEntries(['generator', 'evaluator', 'judge'].map((role) => [role, verifySigned(`runner-start-${role}`)]));
const completions = Object.fromEntries(['generator', 'evaluator', 'judge'].map((role) => [role, verifySigned(`runner-complete-${role}`)]));

assert(manifest.run_id === RUN_ID && manifest.target_head_sha === TARGET, 'manifest run/head 错配');
assert(manifest.repo === 'perfectuser21/zenithjoy-workspace' && manifest.pr_number === 1581, 'manifest repo/PR 错配');
assert(manifest.strict_machine === 'us-mac-m4' && manifest.runner_digest === RUNNER_DIGEST, 'manifest Fleet 目标错配');
assert(pr.headRefOid === TARGET, 'GitHub PR head 已变化');

for (const role of ['generator', 'evaluator', 'judge']) {
  const evidence = roles[role];
  const start = starts[role];
  const complete = completions[role];
  assert(start.issuer === 'fleet-worker' && complete.issuer === 'fleet-worker', `${role} attestation issuer 非 Fleet`);
  for (const item of [start, complete]) {
    assert(item.run_id === RUN_ID && item.role === role && item.target_head_sha === TARGET, `${role} attestation 稳定对象错配`);
    assert(item.machine === 'us-mac-m4' && item.runner_digest === RUNNER_DIGEST, `${role} attestation 执行目标错配`);
    assert(typeof item.attempt_id === 'string' && item.attempt_id, `${role} attempt 缺失`);
    assert(typeof item.capability_snapshot_id === 'string' && item.capability_snapshot_id, `${role} capability 缺失`);
    for (const key of ['provider', 'account', 'machine', 'model']) {
      assert(item.from_target?.[key] === item.to_target?.[key], `${role} ${key} 发生 fallback`);
    }
  }
  assert(start.dispatch_id === complete.dispatch_id, `${role} start/completion dispatch 不同`);
  assert(start.attempt_id === complete.attempt_id && start.capability_snapshot_id === complete.capability_snapshot_id, `${role} start/completion identity 不同`);
  assert(complete.observed_head_sha === TARGET, `${role} completion 未观察到目标头`);
  assert(complete.pr_head_sha === TARGET && complete.pr_state === 'OPEN' && complete.pr_merged_at === null, `${role} Fleet completion 时 PR head/state 违规`);
  assert(complete.evidence_sha256 === digest(`${role}.json`), `${role} completion 未绑定 evidence 摘要`);
  assert(evidence.role === role && evidence.run_id === RUN_ID && evidence.target_head_sha === TARGET, `${role} evidence 稳定对象错配`);
  assert(evidence.provenance?.attempt_id === start.attempt_id, `${role} evidence attempt 未绑定 Fleet start`);
  assert(evidence.provenance?.capability_snapshot_id === start.capability_snapshot_id, `${role} evidence capability 未绑定 Fleet start`);
  assert(evidence.provenance?.machine === 'us-mac-m4' && evidence.provenance?.runner_digest === RUNNER_DIGEST, `${role} evidence target 错配`);
  for (const key of ['provider', 'account', 'machine', 'model']) assert(evidence.provenance?.[key] === start.to_target?.[key], `${role} evidence.${key} 未绑定签名路由`);
  assert(evidence.runner_start_attestation_sha256 === digest(`runner-start-${role}.json`), `${role} start attestation 摘要错配`);
  const started = parseTime(start.started_at, `${role}.started_at`);
  const created = parseTime(evidence.created_at ?? evidence.verdict_at, `${role}.evidence_time`);
  const completed = parseTime(complete.completed_at, `${role}.completed_at`);
  assert(started <= created && created <= completed, `${role} 可信时间窗外证据`);
  assert(complete.exit_code === evidence.exit_code, `${role} completion/evidence exit_code 错配`);
}

assert(new Set(Object.values(starts).map((x) => x.dispatch_id)).size === 3, '三个角色必须独立 Fleet dispatch');
assert(new Set(Object.values(starts).map((x) => x.attempt_id)).size === 3, '三个角色 attempt 必须独立');
assert(new Set(Object.values(starts).map((x) => x.capability_snapshot_id)).size === 3, '三个角色 capability 必须独立');

for (const role of ['generator', 'evaluator']) {
  const evidence = roles[role];
  assert(Number.isInteger(evidence.exit_code) && typeof evidence.log_tail === 'string', `${role} 顶层结果字段缺失`);
  assert(Array.isArray(evidence.checks) && evidence.checks.length === REQUIRED_CHECKS.size, `${role} 必跑检查数量错配`);
  const seen = new Set();
  for (const check of evidence.checks) {
    assert(REQUIRED_CHECKS.has(check.check_id) && !seen.has(check.check_id), `${role} check ID 缺失/重复/未知`);
    seen.add(check.check_id);
    assert(check.command === REQUIRED_CHECKS.get(check.check_id), `${role} check ${check.check_id} 命令漂移`);
    assert(check.executed_head_sha === TARGET, `${role} check ${check.check_id} 未在目标头执行`);
    assert(Number.isInteger(check.exit_code) && typeof check.log_tail === 'string', `${role} check 结果字段缺失`);
    const checkStart = parseTime(check.started_at, `${role}.${check.check_id}.started_at`);
    const checkEnd = parseTime(check.finished_at, `${role}.${check.check_id}.finished_at`);
    assert(parseTime(starts[role].started_at, 'start') <= checkStart && checkStart <= checkEnd && checkEnd <= parseTime(completions[role].completed_at, 'complete'), `${role} check 不在签名执行窗口内`);
  }
  assert(JSON.stringify(completions[role].checks) === JSON.stringify(evidence.checks), `${role} evidence checks 未逐项绑定 Fleet supervisor 捕获结果`);
}

assert(roles.evaluator.generator_evidence_sha256 === digest('generator.json'), 'Evaluator 引用 Generator 摘要错配');
assert(roles.judge.generator_evidence_sha256 === digest('generator.json'), 'Judge 引用 Generator 摘要错配');
assert(roles.judge.evaluator_evidence_sha256 === digest('evaluator.json'), 'Judge 引用 Evaluator 摘要错配');
assert(Array.isArray(roles.judge.behavior_tests), 'Judge behavior_tests 缺失');
assert(JSON.stringify(completions.judge.behavior_tests) === JSON.stringify(roles.judge.behavior_tests), 'Judge behavior_tests 未绑定 Fleet completion');
assert(roles.judge.behavior_tests.map((x) => x.check_id).sort().join(',') === [...JUDGE_CHECK_IDS].sort().join(','), 'Judge check IDs 错配');
assert(roles.judge.behavior_tests.every((x) => Number.isInteger(x.exit_code) && typeof x.log_tail === 'string' && typeof x.evidence === 'string' && ['L2', 'L3'].includes(x.verification_level)), 'Judge 行为结果字段不完整');

const mandatory = [...roles.generator.checks, ...roles.evaluator.checks];
const allPassed = mandatory.every((x) => x.exit_code === 0) && roles.generator.exit_code === 0 && roles.evaluator.exit_code === 0 && roles.judge.behavior_tests.every((x) => x.exit_code === 0);
assert(['PASS', 'FAIL', 'BLOCKED'].includes(roles.judge.verdict), 'Judge verdict 非法');
assert(roles.judge.verdict !== 'PASS' || allPassed, '非零检查被映射为 PASS');
assert(roles.generator.pr_state_at_capture === 'OPEN' && roles.evaluator.pr_state_at_capture === 'OPEN', '角色执行时 PR 非 OPEN');
assert(roles.judge.pr_state_before_verdict === 'OPEN' && roles.judge.pr_merged_at_before_verdict === null, 'verdict 前 PR 已合并');
const runStart = parseTime(starts.generator.started_at, 'run start');
const verdictAt = parseTime(roles.judge.verdict_at, 'verdict_at');
assert(parseTime(completions.generator.completed_at, 'generator complete') <= parseTime(starts.evaluator.started_at, 'evaluator start'), 'Evaluator 在 Generator 完成前启动');
assert(parseTime(completions.evaluator.completed_at, 'evaluator complete') <= parseTime(starts.judge.started_at, 'judge start'), 'Judge 在 Evaluator 完成前启动');
assert(verdictAt - runStart <= 7_200_000, '全链超过 7200 秒');
if (pr.mergedAt !== null) assert(Date.parse(pr.mergedAt) >= verdictAt, 'PR 在 verdict 前合并');

console.log(`OK: signed Fleet evidence verified verdict=${roles.judge.verdict} target=${TARGET}`);
