import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflow = YAML.parse(readFileSync(join(repo, '.github/workflows/ci-l2-consistency.yml'), 'utf8'));
const command = workflow.jobs['orphan-test-check'].steps.find(step => step.name === 'Check all test files are registered in test-registry.yaml').run;
const entry = path => ({ id: path.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), path, type: 'unit', ci: 'L3', status: 'active', product: 'test-fixture' });
function run(files, registry, links = {}) {
  const root = mkdtempSync(join(tmpdir(), 'test-registry-gate-'));
  try {
    symlinkSync(join(repo, 'scripts'), join(root, 'scripts'), 'dir');
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'fixture');
    }
    for (const [path, target] of Object.entries(links)) symlinkSync(target, join(root, path));
    if (registry !== undefined) writeFileSync(join(root, 'test-registry.yaml'), typeof registry === 'string' ? registry : YAML.stringify(registry));
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], { cwd: root, encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const output = result => result.stdout + result.stderr;
const reject = (result, pattern) => { assert.equal(result.status, 1, output(result)); assert.match(output(result), pattern); };

test('missing registry blocks the actual required L2 command', () => reject(run([], undefined), /test-registry.yaml/));
test('malformed YAML cannot pass by containing a path line', () => reject(run(['a.test.ts'], 'tests:\n- id: first\n  path: a.test.ts\n  - id: broken\n'), /YAML|parse|sequence/i));
for (const path of ['orphan.test.mjs', 'orphan.test.cjs', 'orphan.test.py', 'orphan.test.sh', 'orphan.test.ps1', 'orphan.spec.jsx', 'test_native.py', 'native_test.py']) {
  test(`unregistered ${path} blocks the actual L2 command`, () => reject(run([path], { tests: [] }), new RegExp(path.replaceAll('.', '\\.'))));
}
test('registered native, shell and legacy explicit smoke files are accepted', () => {
  const paths = ['native.test.py', 'probe.test.mjs', 'real-smoke.sh'];
  const result = run(paths, { tests: paths.map(entry) });
  assert.equal(result.status, 0, output(result));
});
test('duplicate paths block even when identifiers differ', () => reject(run(['a.test.ts'], { tests: [entry('a.test.ts'), { ...entry('a.test.ts'), id: 'second' }] }), /duplicate.*path/i));
test('duplicate identifiers block even when paths differ', () => reject(run(['a.test.ts', 'b.test.ts'], { tests: [entry('a.test.ts'), { ...entry('b.test.ts'), id: entry('a.test.ts').id }] }), /duplicate.*id/i));
test('missing active file blocks rather than silently preserving stale coverage', () => reject(run([], { tests: [entry('gone.test.ts')] }), /missing.*gone.test.ts/i));
test('invalid fields block rather than merely extracting a path', () => reject(run(['a.test.ts'], { tests: [{ ...entry('a.test.ts'), ci: 'L99', status: 'invented', type: 'bogus', product: '' }] }), /ci|status|type|product/i));
test('repository escaping paths block', () => reject(run([], { tests: [entry('../outside.test.ts')] }), /relative|outside|escape/i));
test('source, dependency, generated and nested worktree caches are excluded', () => {
  const result = run(['real.test.ts', ...['.skills-source', '.skills-runtime', 'node_modules', 'dist', 'build', 'coverage', '.worktrees'].map(dir => `${dir}/orphan.test.mjs`)], { tests: [entry('real.test.ts')] });
  assert.equal(result.status, 0, output(result));
});
test('retirement requires an explanation and cannot conceal a still-present test', () => {
  reject(run([], { tests: [{ ...entry('gone.test.ts'), status: 'deprecated' }] }), /retirement/i);
  const retired = { ...entry('gone.test.ts'), status: 'deprecated', retirement: 'Removed with retired workflow in commit abcdef0.' };
  assert.equal(run([], { tests: [retired] }).status, 0);
  reject(run(['gone.test.ts'], { tests: [retired] }), /retired|deprecated/i);
});
test('inventory records must admit unverified execution and classification', () => {
  const result = run(['probe.test.mjs'], { tests: [{ ...entry('probe.test.mjs'), type: 'unclassified', ci: 'unverified', status: 'pending-ci', product: 'unclassified' }] });
  assert.equal(result.status, 0, output(result));
});
test('L2 product and acceptance commands collect their previously orphaned regressions', () => {
  const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts;
  assert.ok(scripts['test:product-map'].split(/\s+/).includes('scripts/product-map/__tests__/product-map-cli-json.test.js'));
  assert.ok(scripts['test:acceptance-spec'].split(/\s+/).includes('scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js'));
});
test('existing contract and smoke records preserve their named CI declarations', () => {
  const tests = [{ ...entry('guard.test.mjs'), type: 'contract', ci: 'L4-INT' }, { ...entry('live-smoke.sh'), type: 'smoke', ci: 'windows_cloud' }];
  const result = run(tests.map(test => test.path), { tests });
  assert.equal(result.status, 0, output(result));
});
test('superseded regression remains in inventory with explicit live replacements', () => {
  const tests = [{ ...entry('old.test.ts'), status: 'deprecated', deprecation_reason: 'Old tenant trust contract replaced', superseded_by: ['replacement-test-ts'] }, entry('replacement.test.ts')];
  assert.equal(run(tests.map(test => test.path), { tests }).status, 0);
  reject(run(tests.map(test => test.path), { tests: [{ ...tests[0], superseded_by: ['absent'] }, tests[1]] }), /supersed|replacement/i);
});

test('a pending unverified replacement cannot retire an existing regression', () => {
  const tests = [{ ...entry('old.test.ts'), status: 'deprecated', deprecation_reason: 'Replaced', superseded_by: ['new-test-ts'] }, { ...entry('new.test.ts'), status: 'pending-ci', ci: 'unverified' }];
  reject(run(['old.test.ts', 'new.test.ts'], { tests }), /replacement/i);
});
test('a named internal test symlink must be registered', () => {
  reject(run(['owner.mjs'], { tests: [] }, { 'alias.test.mjs': 'owner.mjs' }), /alias\.test\.mjs/);
  const result = run(['owner.mjs'], { tests: [entry('alias.test.mjs')] }, { 'alias.test.mjs': 'owner.mjs' });
  assert.equal(result.status, 0, output(result));
});
test('a named test symlink escaping the repository fails even before registration', () => {
  reject(run([], { tests: [] }, { 'outside.test.mjs': join(repo, 'package.json') }), /escap|outside/i);
});
test('a dangling named test symlink fails even before registration', () => {
  reject(run([], { tests: [] }, { 'dangling.test.mjs': 'absent.mjs' }), /dangling|missing/i);
});
for (const path of ['test_publish_by_content_id.sh', 'test_sync_scraper_to_works.sh', 'test_002_migration.sh']) {
  test(`native shell executor naming ${path} cannot escape inventory`, () => reject(run([path], { tests: [] }), /Unregistered/));
}
