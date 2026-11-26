import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cloudFenceRoute } from '../device-epoch-fence-cloud-migration.mjs';

test('one inherited inode guards both phone lock roots and detects lock drift', async t => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zj-cloud-guard-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const [root, legacy] = ['root', 'legacy'].map(name => join(dir, name));
  for (const path of [root, legacy]) mkdirSync(path, { mode: 0o700 });
  const { serial } = cloudFenceRoute;
  const guard = serial + '.guard';
  writeFileSync(join(root, guard), '', { mode: 0o600 });
  linkSync(join(root, guard), join(legacy, guard));
  writeFileSync(join(root, '.migration-complete.json'), JSON.stringify({
    schema_version: 1, state: 'complete', source_sha256: 'a'.repeat(64), legacy_root: legacy,
  }), { mode: 0o600 });
  const helper = fileURLToPath(new URL('../device-epoch-fence-cloud-guard.py', import.meta.url));
  const args = ['-I', '-B', '-S', helper, root, legacy, serial];
  const holder = spawn('python3', args);
  t.after(() => { if (holder.exitCode === null) holder.kill(); });
  const closed = once(holder, 'close');
  const lines = createInterface({ input: holder.stdout });
  const next = lines[Symbol.asyncIterator]();
  assert.equal((await next.next()).value, 'held');
  assert.equal(spawnSync('python3', args, { input: 'assert\n' }).status, 1);
  holder.stdin.write('assert\n');
  assert.equal((await next.next()).value, 'held');
  mkdirSync(join(legacy, serial + '.lock'));
  holder.stdin.write('assert\n');
  assert.deepEqual(await closed, [1, null]);
  rmSync(join(legacy, serial + '.lock'), { recursive: true });
  assert.equal(spawnSync('python3', args, { input: 'assert\n' }).status, 0);
});
