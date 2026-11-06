import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {runCodeGate} from './helpers/run-code-gate.mjs';
import {openclawStep,captureNodeArgs} from './helpers/openclaw-selection.mjs';

const workflow = YAML.parse(readFileSync(new URL('../../ci-l3-code.yml', import.meta.url), 'utf8'));
const globs = [
  'scripts/openclaw/**/*.test.js',
  'services/phone-adb-controller/__tests__/*.test.mjs',
  '.github/workflows/scripts/__tests__/*.test.mjs',
  'scripts/product-map/__tests__/leadgen-workflow-skill.test.js',
  'scripts/ci/__tests__/native-103-ci-contract.test.mjs',
];
const original = 'node --test ' + globs.join(' ');
function command(w = workflow) {
  return openclawStep(w).run;
}
function validate(w) {
  const job = w.jobs['openclaw-scripts-test'];
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job['timeout-minutes'], 10);
  assert.deepEqual(job.strategy, {'fail-fast': false, matrix: {shard: [1, 2, 3]}});
  const step=openclawStep(w);assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
  const actual=captureNodeArgs(command(w));
  assert.deepEqual(actual.filter(arg=>arg.startsWith('--')),['--test','--test-shard=1/3']);
  const baseline=captureNodeArgs('node --test --test-shard=1/3 '+globs.join(' '));
  const darwinOnly=/\/native-103-(transaction|public-executor|producers)\.test\.mjs$/;
  assert.deepEqual(actual.filter(arg=>!arg.startsWith('--')).sort(),baseline.filter(arg=>!arg.startsWith('--')&&!darwinOnly.test(arg)).sort(),'actual shell argv must preserve the complete original selector union and the new CI contract');
  assert.ok(w.jobs['l3-passed'].needs.includes('openclaw-scripts-test'));
  const recovery=job.steps.find(s=>s.name==='Durable publish recovery core');
  assert.equal(recovery.run,'node --test services/listing-workflow/__tests__/*.test.mjs');
  assert.equal(recovery.if,'matrix.shard == 1');assert.equal(recovery['continue-on-error'],undefined);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-ci-shards-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const files = [
    'scripts/openclaw/a/one.test.js', 'scripts/openclaw/b/two.test.js',
    'services/phone-adb-controller/__tests__/one.test.mjs',
    'services/phone-adb-controller/__tests__/two.test.mjs',
    '.github/workflows/scripts/__tests__/one.test.mjs',
    '.github/workflows/scripts/__tests__/two.test.mjs',
    'scripts/product-map/__tests__/leadgen-workflow-skill.test.js',
    'scripts/ci/__tests__/native-103-ci-contract.test.mjs',
  ];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    writeFileSync(join(root, file), `import test from 'node:test';
import assert from 'node:assert/strict';import fs from 'node:fs';
test(${JSON.stringify(file)},()=>{fs.appendFileSync(process.env.SHARD_TRACE,${JSON.stringify(file + '\n')});
assert.notEqual(process.env.SHARD_FAIL,${JSON.stringify(file)});});\n`);
  }
  // Nested test runners must really execute all fixture files, not inherit the
  // parent runner's internal child mode.
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  return {root, files, env};
}
function run(f, code, name, failed = '') {
  const trace = join(f.root, name + '.trace');
  const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', code], {
    cwd: f.root, env: {...f.env, SHARD_TRACE: trace, SHARD_FAIL: failed},
    encoding: 'utf8', timeout: 15000,
  });
  const rows = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(r.signal, null, r.stdout + r.stderr);
  assert.equal(r.error, undefined, r.stdout + r.stderr);
  return {...r, rows};
}
function shardCommand(index) {
  return command().replaceAll('${{ matrix.shard }}', String(index));
}
function aggregate(result) { return runCodeGate(workflow,result); }

test('OpenClaw keeps original four selectors in three independent ten-minute native shards', () => {
  validate(workflow);
});
test('actual matrix commands execute the original file union exactly once across all three shards', t => {
  const f = fixture(t), all = run(f, original, 'all');
  assert.equal(all.status, 0, all.stdout + all.stderr);
  assert.deepEqual(all.rows.slice().sort(), f.files.slice().sort());
  const previous = [1, 2].map(i => run(f, 'node --test --test-shard='+i+'/2 '+globs.join(' '), 'previous-'+i));
  for (const r of previous) assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(previous.flatMap(r=>r.rows).sort(),all.rows.slice().sort(),'the original two-shard union is the fixed baseline');
  const parts = [1, 2, 3].map(i => run(f, shardCommand(i), 'part-' + i));
  for (const r of parts) assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(parts.every(r => r.rows.length > 0));
  const combined = parts.flatMap(r => r.rows);
  assert.equal(new Set(combined).size, combined.length, 'a test file must never run in multiple shards');
  assert.deepEqual(combined.slice().sort(), all.rows.slice().sort(), 'no original file may be omitted');
});
test('a real fixture failure fails exactly one native shard and the unchanged L3 aggregate rejects it', t => {
  const f = fixture(t);
  const results = [1, 2, 3].map(i => run(f, shardCommand(i), 'failed-' + i, f.files[0]));
  assert.deepEqual(results.map(r => r.status).sort(), [0, 0, 1]);
  assert.equal(aggregate('success').status, 0);
  for (const status of ['failure', 'cancelled', 'skipped']) assert.equal(aggregate(status).status, 1, status);
});
test('missing or duplicate shards, filters, larger timeout and detached aggregate remain rejected', () => {
  for (const mutate of [
    j => {j.strategy.matrix.shard = [1];},
    j => {j.strategy.matrix.shard = [1, 1];},
    j => {j.strategy['fail-fast'] = true;},
    j => {j['timeout-minutes'] = 11;},
    j => {j.if = 'false';},
    j => {j.steps.find(s => s.name===openclawStep(workflow).name).run = original;},
    j => {j.steps.find(s => s.name===openclawStep(workflow).name).run += ' --test-name-pattern=one';},
    j => {j.steps.find(s => s.name===openclawStep(workflow).name).run += ' --test-skip-pattern=two';},
  ]) {
    const w = structuredClone(workflow);
    // Shape mutations also remain meaningful before the RED implementation.
    w.jobs['openclaw-scripts-test'].strategy ??= {'fail-fast': false, matrix: {shard: [1, 2, 3]}};
    mutate(w.jobs['openclaw-scripts-test']);
    assert.throws(() => validate(w));
  }
  const w = structuredClone(workflow);
  w.jobs['l3-passed'].needs = w.jobs['l3-passed'].needs.filter(n => n !== 'openclaw-scripts-test');
  assert.throws(() => validate(w));
});

// Listing recovery is independent of OpenClaw's file sharding. Run its full
// failure semantics once, inside the already required matrix aggregate.
function validateRecovery(w) {
  const steps = w.jobs['openclaw-scripts-test'].steps.filter(s => s.run?.includes('services/listing-workflow/__tests__/*.test.mjs'));
  assert.equal(steps.length, 1);
  assert.equal(steps[0].run, 'node --test services/listing-workflow/__tests__/*.test.mjs');
  assert.equal(steps[0].if, 'matrix.shard == 1');
  assert.equal(steps[0]['continue-on-error'], undefined);
  assert.ok(w.jobs['l3-passed'].needs.includes('openclaw-scripts-test'));
}
test('durable recovery runs its complete suite once and remains required', () => {
  validateRecovery(workflow);
  for (const mutate of [
    w => {delete w.jobs['openclaw-scripts-test'].steps.find(s => s.name === 'Durable publish recovery core').if;},
    w => {w.jobs['openclaw-scripts-test'].steps.find(s => s.name === 'Durable publish recovery core')['continue-on-error'] = true;},
    w => {w.jobs['l3-passed'].needs = w.jobs['l3-passed'].needs.filter(n => n !== 'openclaw-scripts-test');},
  ]) {
    const w = structuredClone(workflow); mutate(w); assert.throws(() => validateRecovery(w));
  }
});

// Execute the actual matrix's two Node steps against independent local suites.
// Trace individual recovery cases, not just a declaration or a job name.
function recoveryFixture(t) {
  const f = fixture(t);
  f.recoveryCases = [];
  for (const name of ['coordinator', 'reconcile', 'cleanup']) {
    const file = 'services/listing-workflow/__tests__/' + name + '.test.mjs';
    const cases = ['normal', 'lost-response'].map(scenario => file + '#' + scenario);
    f.recoveryCases.push(...cases);
    mkdirSync(dirname(join(f.root, file)), {recursive: true});
    writeFileSync(join(f.root, file),
      "import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';\n" +
      cases.map(id => 'test(' + JSON.stringify(id) + ',()=>{' +
        'fs.appendFileSync(process.env.SHARD_TRACE,' + JSON.stringify(id + '\n') + ');' +
        'assert.notEqual(process.env.SHARD_FAIL,' + JSON.stringify(id) + ');});').join('\n'));
  }
  return f;
}
function matrixExecutions(f, w, name, failed = '') {
  const job = w.jobs['openclaw-scripts-test'];
  return job.strategy.matrix.shard.map(shard => {
    const scripts = job.steps
      .filter(step => step===openclawStep(w)||step.run?.startsWith('node --test'))
      .filter(step => step.if === undefined ||
        Function('matrix', 'return (' + step.if + ')')({shard}))
      .map(step => step.run.replaceAll('$' + '{{ matrix.shard }}', String(shard)));
    return {...run(f, scripts.join('\n'), name + '-' + shard, failed), shard};
  });
}
function assertRecoveryExecution(f, parts) {
  assert.deepEqual(parts.map(p => p.shard), [1, 2, 3]);
  const recovered = parts.map(p => p.rows.filter(row => row.startsWith('services/listing-workflow/')));
  assert.deepEqual(recovered[0].slice().sort(), f.recoveryCases.slice().sort(),
    'shard 1 must execute every recovery case exactly once');
  assert.deepEqual(recovered[1], [], 'shard 2 must not repeat recovery');
  assert.deepEqual(recovered[2], [], 'shard 3 must not repeat recovery');
  const all = recovered.flat();
  assert.equal(new Set(all).size, all.length, 'recovery cases must never repeat');
  assert.deepEqual(all.slice().sort(), f.recoveryCases.slice().sort(), 'no recovery case may disappear');
}
test('actual three-leg workflow executes the complete recovery suite only on shard 1', t => {
  const f = recoveryFixture(t), parts = matrixExecutions(f, workflow, 'recovery-once');
  for (const p of parts) assert.equal(p.status, 0, p.stdout + p.stderr);
  assertRecoveryExecution(f, parts);
});
test('a real recovery failure fails shard 1 and the required YAML aggregate', t => {
  const f = recoveryFixture(t), parts = matrixExecutions(f, workflow, 'recovery-failure', f.recoveryCases[0]);
  assert.deepEqual(parts.map(p => p.status), [1, 0, 0]);
  assertRecoveryExecution(f, parts);
  assert.equal(aggregate(parts.some(p => p.status !== 0) ? 'failure' : 'success').status, 1);
});
for (const [name, mutate] of [
  ['missing recovery step', job => {job.steps = job.steps.filter(step => step.name !== 'Durable publish recovery core');}],
  ['wrong recovery shard', job => {job.steps.find(step => step.name === 'Durable publish recovery core').if = 'matrix.shard == 2';}],
  ['duplicate recovery step', job => {job.steps.push(structuredClone(job.steps.find(step => step.name === 'Durable publish recovery core')));}],
  ['unconditional repeated recovery', job => {delete job.steps.find(step => step.name === 'Durable publish recovery core').if;}],
]) {
  test('real matrix traces reject ' + name, t => {
    const f = recoveryFixture(t), w = structuredClone(workflow);
    mutate(w.jobs['openclaw-scripts-test']);
    assert.throws(() => validateRecovery(w));
    const parts = matrixExecutions(f, w, name.replaceAll(' ', '-'));
    for (const p of parts) assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.throws(() => assertRecoveryExecution(f, parts));
  });
}
