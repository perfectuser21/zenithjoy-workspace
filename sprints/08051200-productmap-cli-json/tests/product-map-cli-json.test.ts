import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const cli = resolve(repo, 'scripts/product-map/cli.mjs');

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'product-map-cli-json-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'product-map/generated'), { recursive: true });
  cpSync(resolve(repo, 'scripts/product-map'), join(root, 'scripts/product-map'), { recursive: true });
  cpSync(resolve(repo, 'product-map/product-map.yaml'), join(root, 'product-map/product-map.yaml'));
  cpSync(resolve(repo, 'product-map/product-map.schema.json'), join(root, 'product-map/product-map.schema.json'));
  cpSync(resolve(repo, 'product-map/generated/product-map.json'), join(root, 'product-map/generated/product-map.json'));
  cpSync(resolve(repo, 'product-map/generated/product-map.md'), join(root, 'product-map/generated/product-map.md'));
  symlinkSync(resolve(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(root, 'scripts/product-map/cli.mjs'), 'check', ...args], { cwd: root, encoding: 'utf8' });
}

test('check --json 成功时输出含 ok/errors 的 JSON', () => {
  const result = spawnSync(process.execPath, [cli, 'check', '--json'], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.errors, []);
});

test('check --json 对损坏或缺失 JSON 输出结构化失败', async t => {
  for (const kind of ['broken', 'missing']) {
    await t.test(kind, () => {
      const root = fixture();
      try {
        const path = join(root, 'product-map/generated/product-map.json');
        kind === 'broken' ? writeFileSync(path, '{broken') : rmSync(path);
        const result = run(root, '--json');
        assert.notEqual(result.status, 0);
        assert.equal(result.stderr, '');
        const body = JSON.parse(result.stdout);
        assert.equal(body.ok, false);
        assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
        assert.ok(body.errors.every((error: unknown) => typeof error === 'string' && error.length > 0));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test('普通 check 的成功与失败输出逐字保持兼容', async t => {
  const success = spawnSync(process.execPath, [cli, 'check'], { cwd: repo, encoding: 'utf8' });
  const digest = JSON.parse(readFileSync(resolve(repo, 'product-map/generated/product-map.json'), 'utf8')).digest.slice(0, 8);
  assert.equal(success.status, 0);
  assert.equal(success.stdout, `PASS: no drift — generated files match current product-map.yaml (digest: ${digest}...)\n`);
  assert.equal(success.stderr, '');

  await t.test('missing', () => {
    const root = fixture();
    try {
      rmSync(join(root, 'product-map/generated/product-map.json'));
      const result = run(root);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'FAIL: drift — product-map/generated/product-map.json does not exist. Run npm run product-map:generate first.\n');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  await t.test('digest drift', () => {
    const root = fixture();
    try {
      const path = join(root, 'product-map/generated/product-map.json');
      const generated = JSON.parse(readFileSync(path, 'utf8'));
      const oldDigest = generated.digest;
      generated.digest = `00000000${oldDigest.slice(8)}`;
      writeFileSync(path, JSON.stringify(generated));
      const result = run(root);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `FAIL: drift detected — generated digest 00000000 does not match current YAML digest ${oldDigest.slice(0, 8)}\nRun npm run product-map:generate to update the generated files.\n`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
