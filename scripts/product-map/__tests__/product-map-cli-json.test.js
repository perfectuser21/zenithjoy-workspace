import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const passText = readFileSync(resolve(repoRoot, 'product-map/generated/product-map.json'), 'utf8');
const digest = JSON.parse(passText).digest;
const expectedText = `PASS: no drift — generated files match current product-map.yaml (digest: ${digest.slice(0, 8)}...)\n`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'product-map-cli-json-'));
  cpSync(resolve(repoRoot, 'scripts/product-map'), resolve(root, 'scripts/product-map'), { recursive: true });
  cpSync(resolve(repoRoot, 'product-map'), resolve(root, 'product-map'), { recursive: true });
  symlinkSync(resolve(repoRoot, 'node_modules'), resolve(root, 'node_modules'), 'dir');
  const generated = JSON.parse(readFileSync(resolve(root, 'product-map/generated/product-map.json'), 'utf8'));
  for (const gp of generated.golden_paths ?? []) {
    for (const path of gp.smoke_files ?? []) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      cpSync(resolve(repoRoot, path), resolve(root, path));
    }
  }
  // 主干活动契约（决策 3240824c）引用的探针文件与账本脚本，check 会一并校验
  const contracts = JSON.parse(readFileSync(resolve(root, 'product-map/generated/contracts.json'), 'utf8'));
  const deps = new Set();
  for (const cap of Object.keys(contracts.capabilities)) {
    const text = readFileSync(resolve(root, `product-map/contracts/${cap}.yaml`), 'utf8');
    for (const m of text.matchAll(/^(?:checks|ledger): (\S+)$/gm)) deps.add(m[1]);
  }
  for (const path of deps) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    cpSync(resolve(repoRoot, path), resolve(root, path));
  }
  return root;
}

function run(root, args = ['check', '--json']) {
  return spawnSync(process.execPath, ['scripts/product-map/cli.mjs', ...args], { cwd: root, encoding: 'utf8' });
}

function jsonResult(result, expectedStatus) {
  assert.equal(result.status, expectedStatus);
  assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(value).sort(), ['errors', 'ok']);
  assert.equal(typeof value.ok, 'boolean');
  assert.ok(Array.isArray(value.errors) && value.errors.every(error => typeof error === 'string'));
  return value;
}

async function withFixture(fn) {
  const root = fixture();
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('成功时只输出 ok=true 与空 errors', () => withFixture(root => {
  assert.deepEqual(jsonResult(run(root), 0), { ok: true, errors: [] });
}));

test('缺少 product-map.json 时输出合法失败 JSON', () => withFixture(root => {
  unlinkSync(resolve(root, 'product-map/generated/product-map.json'));
  const value = jsonResult(run(root), 1);
  assert.equal(value.ok, false);
  assert.ok(value.errors.some(error => /does not exist/i.test(error)));
}));

test('不可解析 product-map.json 时输出具体错误 JSON', () => withFixture(root => {
  writeFileSync(resolve(root, 'product-map/generated/product-map.json'), '{broken', 'utf8');
  const value = jsonResult(run(root), 1);
  assert.equal(value.ok, false);
  assert.ok(value.errors.some(error => /json|parse|unexpected/i.test(error)));
}));

test('不带 --json 时成功 stdout 与既有文本逐字一致', () => withFixture(root => {
  const result = run(root, ['check']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, expectedText);
}));

test('多个检查问题分别进入 errors 且失败对象严格 keys', () => withFixture(root => {
  const jsonPath = resolve(root, 'product-map/generated/product-map.json');
  const generated = JSON.parse(readFileSync(jsonPath, 'utf8'));
  generated.digest = '0'.repeat(64);
  writeFileSync(jsonPath, `${JSON.stringify(generated, null, 2)}\n`);
  writeFileSync(resolve(root, 'product-map/generated/product-map.md'), '# wrong digest\n');
  const smokePath = generated.golden_paths.find(gp => gp.smoke_files?.length)?.smoke_files[0];
  rmSync(resolve(root, smokePath));
  const value = jsonResult(run(root), 1);
  assert.equal(value.ok, false);
  assert.ok(value.errors.length >= 3);
  assert.ok(value.errors.some(error => /digest|drift/i.test(error)));
  assert.ok(value.errors.some(error => /markdown|product-map\.md/i.test(error)));
  assert.ok(value.errors.some(error => /smoke/i.test(error)));
}));

test('既有 check 位置参数与新增 --json 选项并存', () => withFixture(root => {
  assert.deepEqual(jsonResult(run(root, ['check', '--json']), 0), { ok: true, errors: [] });
}));

// 0930 回归：主干活动契约（product-map/contracts/*.yaml）改了但 generated/contracts.json 没重生成时，
// 文本模式 check 报 drift 退 1，而 --json 模式漏了这项校验静默放行——两种模式必须校验同一组东西。
test('contracts.json 与当前契约哈希不符时 --json 也必须报 drift', () => withFixture(root => {
  const contractsPath = resolve(root, 'product-map/generated/contracts.json');
  const stale = JSON.parse(readFileSync(contractsPath, 'utf8'));
  stale.digest = '0'.repeat(64);
  writeFileSync(contractsPath, `${JSON.stringify(stale, null, 2)}\n`);
  const value = jsonResult(run(root), 1);
  assert.equal(value.ok, false);
  assert.ok(value.errors.some(error => /contracts\.json/.test(error)), JSON.stringify(value.errors));
  const text = run(root, ['check']);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /contracts\.json/);
}));
