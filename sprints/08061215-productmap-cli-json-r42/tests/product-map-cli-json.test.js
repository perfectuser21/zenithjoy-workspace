import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const cli = resolve(repoRoot, 'scripts/product-map/cli.mjs');

function run(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

test('check --json 成功时仅输出 ok=true 与空 errors 且退出 0', () => {
  const result = run(['check', '--json']);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, errors: [] });
  assert.equal(result.stderr, '');
});

test('check --json 缺少 product-map.json 时输出合法失败 JSON 且退出非 0', () => {
  const fixture = mkdtempSync(resolve(repoRoot, '.tmp-product-map-json-'));
  try {
    cpSync(resolve(repoRoot, 'scripts/product-map'), resolve(fixture, 'scripts/product-map'), { recursive: true });
    cpSync(resolve(repoRoot, 'product-map'), resolve(fixture, 'product-map'), { recursive: true });
    rmSync(resolve(fixture, 'product-map/generated/product-map.json'));
    const result = spawnSync(process.execPath, [resolve(fixture, 'scripts/product-map/cli.mjs'), 'check', '--json'], { cwd: fixture, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.ok(body.errors.some((message) => message.includes('does not exist')));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('check --json 遇到不可解析 product-map.json 时仍输出合法失败 JSON', () => {
  const jsonPath = resolve(repoRoot, 'product-map/generated/product-map.json');
  const original = readFileSync(jsonPath, 'utf8');
  try {
    writeFileSync(jsonPath, '{invalid-json\n');
    const result = run(['check', '--json']);
    assert.notEqual(result.status, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.ok(body.errors.some((message) => /parse|json/i.test(message)));
  } finally {
    writeFileSync(jsonPath, original);
  }
});

test('check --json 与既有额外参数并存时保持 JSON 语义', () => {
  const result = run(['check', '--json', '--unused-existing-compatible']);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, errors: [] });
});

test('check --json 多个检查问题同时存在时 errors 逐项表达', () => {
  const fixture = mkdtempSync(resolve(repoRoot, '.tmp-product-map-multi-'));
  try {
    cpSync(resolve(repoRoot, 'scripts/product-map'), resolve(fixture, 'scripts/product-map'), { recursive: true });
    cpSync(resolve(repoRoot, 'product-map'), resolve(fixture, 'product-map'), { recursive: true });
    const yamlPath = resolve(fixture, 'product-map/product-map.yaml');
    const yaml = readFileSync(yamlPath, 'utf8')
      .replace('.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh', 'harness-missing-one.sh')
      .replace('.github/workflows/scripts/smoke/golden-path-1-smoke.sh', 'harness-missing-two.sh');
    writeFileSync(yamlPath, yaml);
    const result = spawnSync(process.execPath, [resolve(fixture, 'scripts/product-map/cli.mjs'), 'check', '--json'], { cwd: fixture, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.ok(body.errors.length >= 3);
    assert.ok(body.errors.some((message) => /digest/i.test(message)));
    assert.ok(body.errors.some((message) => message.includes('harness-missing-one.sh')));
    assert.ok(body.errors.some((message) => message.includes('harness-missing-two.sh')));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('不带 --json 的成功输出逐字保持现有文本', () => {
  const result = run(['check']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^PASS: no drift — generated files match current product-map\.yaml \(digest: [a-f0-9]{8}\.\.\.\)\n$/);
  assert.equal(result.stderr, '');
});

test('不带 --json 的失败输出与退出码逐字保持冻结合同锚', () => {
  const fixture = mkdtempSync(resolve(repoRoot, '.tmp-product-map-text-fail-'));
  try {
    for (const name of ['base', 'candidate']) {
      cpSync(resolve(repoRoot, 'scripts/product-map'), resolve(fixture, name, 'scripts/product-map'), { recursive: true });
      cpSync(resolve(repoRoot, 'product-map'), resolve(fixture, name, 'product-map'), { recursive: true });
      const jsonPath = resolve(fixture, name, 'product-map/generated/product-map.json');
      const generated = JSON.parse(readFileSync(jsonPath, 'utf8'));
      generated.digest = `00000000${generated.digest.slice(8)}`;
      writeFileSync(jsonPath, `${JSON.stringify(generated, null, 2)}\n`);
    }
    const baseline = spawnSync('git', ['show', '1c0df82311dc685cb44f497a13b4b295b0fcf4d9:scripts/product-map/cli.mjs'], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(baseline.status, 0);
    writeFileSync(resolve(fixture, 'base/scripts/product-map/cli.mjs'), baseline.stdout);
    const base = spawnSync(process.execPath, ['scripts/product-map/cli.mjs', 'check'], { cwd: resolve(fixture, 'base'), encoding: 'utf8' });
    const candidate = spawnSync(process.execPath, ['scripts/product-map/cli.mjs', 'check'], { cwd: resolve(fixture, 'candidate'), encoding: 'utf8' });
    assert.notEqual(base.status, 0);
    assert.equal(candidate.status, base.status);
    assert.equal(candidate.stdout, base.stdout);
    assert.equal(candidate.stderr, base.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
