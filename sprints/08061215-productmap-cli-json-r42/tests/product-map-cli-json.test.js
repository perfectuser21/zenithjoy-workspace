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

test('不带 --json 的成功输出逐字保持现有文本', () => {
  const result = run(['check']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^PASS: no drift — generated files match current product-map\.yaml \(digest: [a-f0-9]{8}\.\.\.\)\n$/);
  assert.equal(result.stderr, '');
});
