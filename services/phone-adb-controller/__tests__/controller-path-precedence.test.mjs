import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const script = resolve('services/phone-adb-controller/harvest-keyword.sh');
for (const [name, env, expected] of [
  ['隔离控制器覆盖默认路径', { DOUYIN_PHONE_CONTROLLER: '/isolated/controller' }, '/isolated/controller'],
  ['冻结控制器优先于外部隔离覆盖', { DOUYIN_PHONE_ADB: '/frozen/controller', DOUYIN_PHONE_CONTROLLER: '/isolated/controller' }, '/frozen/controller'],
]) test(name, () => {
  const r = spawnSync('zsh', ['-c', 'HARVEST_KEYWORD_LIB=1 source "$1" p keyword 1 T unlimited line; print -r -- "$C"', '_', script], { encoding: 'utf8', env: { ...process.env, DOUYIN_PHONE_ADB: '', DOUYIN_PHONE_CONTROLLER: '', ...env } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), expected);
});
