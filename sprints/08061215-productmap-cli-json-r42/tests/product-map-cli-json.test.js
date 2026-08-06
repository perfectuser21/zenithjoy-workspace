import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');

function sandbox() {
  const root = mkdtempSync(resolve(repo, '.product-map-cli-json-'));
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  cpSync(resolve(repo, 'scripts/product-map'), resolve(root, 'scripts/product-map'), { recursive: true });
  cpSync(resolve(repo, 'product-map'), resolve(root, 'product-map'), { recursive: true });
  cpSync(resolve(repo, '.github/workflows/scripts/smoke'), resolve(root, '.github/workflows/scripts/smoke'), { recursive: true });
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, ['scripts/product-map/cli.mjs', 'check', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function withSandbox(fn) {
  const root = sandbox();
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('check --json 成功时只输出 ok=true 与空 errors 且退出码为 0', () => withSandbox(root => {
  const result = run(root, '--json');
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, errors: [] });
  assert.equal(result.stdout.trim().split('\n').length, 1, 'stdout 必须是单个 JSON 对象');
}));

test('check --json 缺少 product-map.json 时输出合法失败 JSON 且非零退出', () => withSandbox(root => {
  rmSync(resolve(root, 'product-map/generated/product-map.json'));
  const result = run(root, '--json');
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, '');
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.errors.every(error => typeof error === 'string'));
  assert.ok(body.errors.some(error => error.includes('product-map.json') && error.includes('does not exist')));
}));

test('check --json 遇到不可解析 product-map.json 时输出具体错误 JSON 且非零退出', () => withSandbox(root => {
  writeFileSync(resolve(root, 'product-map/generated/product-map.json'), '{broken json', 'utf8');
  const result = run(root, '--json');
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, '');
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.errors.some(error => /parse|JSON/i.test(error)));
}));

test('check 不带 --json 时成功 stdout 与既有文本逐字一致', () => withSandbox(root => {
  const generated = JSON.parse(readFileSync(resolve(root, 'product-map/generated/product-map.json'), 'utf8'));
  const result = run(root);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `PASS: no drift — generated files match current product-map.yaml (digest: ${generated.digest.slice(0, 8)}...)\n`);
}));

test('check --json 与其他既有参数并存时仍返回同一 JSON 结论', () => withSandbox(root => {
  const result = run(root, '--json', '--verbose');
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, errors: [] });
}));
