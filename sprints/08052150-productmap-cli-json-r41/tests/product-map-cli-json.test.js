import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../../..');
const sandboxes = [];

function sandbox() {
  const root = mkdtempSync(resolve(repoRoot, '.harness-product-map-'));
  sandboxes.push(root);
  cpSync(resolve(repoRoot, 'scripts/product-map'), resolve(root, 'scripts/product-map'), { recursive: true });
  cpSync(resolve(repoRoot, 'product-map'), resolve(root, 'product-map'), { recursive: true });
  cpSync(resolve(repoRoot, '.github/workflows/scripts/smoke'), resolve(root, '.github/workflows/scripts/smoke'), { recursive: true });
  return root;
}

function check(root, args = ['check', '--json']) {
  return spawnSync(process.execPath, ['scripts/product-map/cli.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (sandboxes.length) rmSync(sandboxes.pop(), { recursive: true, force: true });
});

test('check --json 成功时 stdout 仅为 ok/errors JSON 且退出 0', () => {
  const result = check(sandbox());
  assert.equal(result.status, 0);
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), ['errors', 'ok']);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, errors: [] });
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('check --json 漂移失败时 stdout 仍为单个 JSON 且退出非 0', () => {
  const root = sandbox();
  const jsonPath = resolve(root, 'product-map/generated/product-map.json');
  const generated = JSON.parse(readFileSync(jsonPath, 'utf8'));
  generated.digest = '0'.repeat(64);
  writeFileSync(jsonPath, JSON.stringify(generated));
  const result = check(root);
  assert.notEqual(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.errors) && body.errors.some((error) => typeof error === 'string' && error.includes('digest')));
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('check --json 在 product-map.json 缺失或不可解析时始终输出合法失败 JSON', () => {
  for (const mode of ['missing', 'malformed']) {
    const root = sandbox();
    const jsonPath = resolve(root, 'product-map/generated/product-map.json');
    if (mode === 'missing') rmSync(jsonPath);
    else writeFileSync(jsonPath, '{not-json');
    const result = check(root);
    assert.notEqual(result.status, 0, mode);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false, mode);
    assert.ok(Array.isArray(body.errors) && body.errors.length >= 1, mode);
    assert.equal(result.stdout.trim().split('\n').length, 1, mode);
  }
});

test('不带 --json 的 check 输出与既有文本逐字一致', () => {
  const root = sandbox();
  const digest = JSON.parse(readFileSync(resolve(root, 'product-map/generated/product-map.json'), 'utf8')).digest;
  const result = check(root, ['check']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `PASS: no drift — generated files match current product-map.yaml (digest: ${digest.slice(0, 8)}...)\n`);
});
