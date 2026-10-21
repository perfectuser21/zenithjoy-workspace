import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync(new URL('../../ci-l3-code.yml', import.meta.url), 'utf8'));
const globs = [
  'scripts/openclaw/**/*.test.js',
  'services/phone-adb-controller/__tests__/*.test.mjs',
  '.github/workflows/scripts/__tests__/*.test.mjs',
  'scripts/product-map/__tests__/leadgen-workflow-skill.test.js',
];
const original = 'node --test ' + globs.join(' ');
function command(w = workflow) {
  return w.jobs['openclaw-scripts-test'].steps.find(s => s.run?.startsWith('node --test'))?.run;
}
function validate(w) {
  const job = w.jobs['openclaw-scripts-test'];
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job['timeout-minutes'], 10);
  assert.deepEqual(job.strategy, {'fail-fast': false, matrix: {shard: [1, 2]}});
  assert.equal(command(w), 'node --test --test-shard=${{ matrix.shard }}/2 ' + globs.join(' '));
  assert.ok(w.jobs['l3-passed'].needs.includes('openclaw-scripts-test'));
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
function aggregate(result) {
  const code = workflow.jobs['l3-passed'].steps[0].run.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g,
    (_, key) => key === 'needs.openclaw-scripts-test.result' ? result : key.includes('.outputs.') ? 'false' : 'success');
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', code], {encoding: 'utf8', timeout: 5000});
}

test('OpenClaw keeps original four selectors in two independent ten-minute native shards', () => {
  validate(workflow);
});
test('actual matrix commands execute the original file union exactly once across both shards', t => {
  const f = fixture(t), all = run(f, original, 'all');
  assert.equal(all.status, 0, all.stdout + all.stderr);
  assert.deepEqual(all.rows.slice().sort(), f.files.slice().sort());
  const parts = [1, 2].map(i => run(f, shardCommand(i), 'part-' + i));
  for (const r of parts) assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(parts.every(r => r.rows.length > 0));
  const combined = parts.flatMap(r => r.rows);
  assert.equal(new Set(combined).size, combined.length, 'a test file must never run in both shards');
  assert.deepEqual(combined.slice().sort(), all.rows.slice().sort(), 'no original file may be omitted');
});
test('a real fixture failure fails exactly one native shard and the unchanged L3 aggregate rejects it', t => {
  const f = fixture(t);
  const results = [1, 2].map(i => run(f, shardCommand(i), 'failed-' + i, f.files[0]));
  assert.deepEqual(results.map(r => r.status).sort(), [0, 1]);
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
    j => {j.steps.find(s => s.run?.startsWith('node --test')).run = original;},
    j => {j.steps.find(s => s.run?.startsWith('node --test')).run += ' --test-name-pattern=one';},
    j => {j.steps.find(s => s.run?.startsWith('node --test')).run += ' --test-skip-pattern=two';},
  ]) {
    const w = structuredClone(workflow);
    // Shape mutations also remain meaningful before the RED implementation.
    w.jobs['openclaw-scripts-test'].strategy ??= {'fail-fast': false, matrix: {shard: [1, 2]}};
    mutate(w.jobs['openclaw-scripts-test']);
    assert.throws(() => validate(w));
  }
  const w = structuredClone(workflow);
  w.jobs['l3-passed'].needs = w.jobs['l3-passed'].needs.filter(n => n !== 'openclaw-scripts-test');
  assert.throws(() => validate(w));
});
