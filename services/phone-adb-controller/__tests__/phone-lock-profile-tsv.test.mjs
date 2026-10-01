import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const helper = new URL('../phone-lock-helper.py', import.meta.url).pathname;

test('巡检原始TSV中前置引号昵称不能吞掉后续在线手机', t => {
  const temp = mkdtempSync(join(tmpdir(), 'phone-lock-profile-tsv-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const registry = join(temp, 'profiles.tsv');
  writeFileSync(registry, '#registry_version 2\n'
    + '#profile\tserial\tmodel\twidth\theight\tnickname\thost\n'
    + 'p1\tSER1\tMODEL\t1080\t2412\t"小号\txian-m1\n'
    + 'p2\tSER2\tMODEL\t1200\t2664\t小二\txian-m1\n');
  const result = spawnSync('python3', [helper, 'profiles', 'SER1', 'SER2'], {
    env: { ...process.env, DOUYIN_PHONE_REGISTRY: registry },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'p1\tSER1\np2\tSER2\n');
});
