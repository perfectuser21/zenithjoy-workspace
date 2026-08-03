import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [evidenceDir, prJsonPath] = process.argv.slice(2);
if (!evidenceDir || !prJsonPath) {
  throw new Error('用法: node validate-fleet-evidence.mjs <evidence-dir> <pr-json>');
}

const read = (name) => JSON.parse(readFileSync(join(evidenceDir, name), 'utf8'));
const digest = (name) => createHash('sha256').update(readFileSync(join(evidenceDir, name))).digest('hex');
const requiredIdentity = ['attempt_id', 'provider', 'account', 'machine', 'model', 'runner_digest', 'capability_snapshot_id'];
const target = 'c305f6217da65bb69413c39e621b7e797e0fb189';
const runId = '5a037785-2708-489e-9912-b20494f11fd9';
const runnerDigest = 'sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a';

const manifest = read('run-manifest.json');
const generator = read('generator.json');
const evaluator = read('evaluator.json');
const judge = read('judge.json');
const pr = JSON.parse(readFileSync(prJsonPath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.run_id === runId, 'run manifest run_id 错配');
assert(manifest.target_head_sha === target, 'run manifest target SHA 错配');
assert(manifest.strict_machine === 'us-mac-m4', 'strict machine 错配');
assert(manifest.runner_digest === runnerDigest, 'runner digest 错配');
assert(pr.headRefOid === target, 'GitHub PR head 已变化');

for (const [role, evidence] of [['generator', generator], ['evaluator', evaluator], ['judge', judge]]) {
  assert(evidence.role === role, `${role} role 错配`);
  assert(evidence.run_id === runId, `${role} run_id 错配`);
  assert(evidence.target_head_sha === target, `${role} target SHA 错配`);
  for (const key of requiredIdentity) assert(typeof evidence.provenance?.[key] === 'string' && evidence.provenance[key].length > 0, `${role} provenance.${key} 缺失`);
  assert(evidence.provenance.machine === 'us-mac-m4', `${role} 未命中 us-mac-m4`);
  assert(evidence.provenance.runner_digest === runnerDigest, `${role} runner digest 错配`);
  assert(evidence.routing?.fallback_used === false, `${role} 使用了 fallback`);
}

assert(new Set([generator.provenance.attempt_id, evaluator.provenance.attempt_id, judge.provenance.attempt_id]).size === 3, '三个角色 attempt 必须两两不同');
assert(evaluator.generator_evidence_sha256 === digest('generator.json'), 'Evaluator 引用的 Generator 摘要错配');
assert(judge.generator_evidence_sha256 === digest('generator.json'), 'Judge 引用的 Generator 摘要错配');
assert(judge.evaluator_evidence_sha256 === digest('evaluator.json'), 'Judge 引用的 Evaluator 摘要错配');

const times = [manifest.started_at, generator.created_at, evaluator.created_at, judge.verdict_at].map((value) => Date.parse(value));
assert(times.every(Number.isFinite), '证据时间戳无效');
assert(times.every((value, index) => index === 0 || value >= times[index - 1]), '角色证据时间顺序无效');
assert(times[3] - times[0] <= 7_200_000, '全链超过 7200 秒');
assert(generator.pr_state_at_capture === 'OPEN' && evaluator.pr_state_at_capture === 'OPEN', 'Generator/Evaluator capture 时 PR 非 OPEN');
assert(judge.pr_state_before_verdict === 'OPEN' && judge.pr_merged_at_before_verdict === null, 'verdict 前 PR 已合并');
assert(['PASS', 'FAIL', 'BLOCKED'].includes(judge.verdict), 'Judge verdict 非法');
assert(Number.isInteger(judge.exit_code) && typeof judge.log_tail === 'string', 'Judge 顶层 exit_code/log_tail 缺失');
assert(Array.isArray(judge.behavior_tests) && judge.behavior_tests.length >= 4, 'Judge behavior_tests 不完整');
assert(judge.behavior_tests.every((item) => Number.isInteger(item.exit_code) && typeof item.log_tail === 'string'), 'Judge 行为项 exit_code/log_tail 缺失');
if (pr.mergedAt !== null) assert(Date.parse(pr.mergedAt) >= times[3], 'PR 在 verdict 前合并');

console.log(`OK: evidence chain verified verdict=${judge.verdict} target=${target}`);
