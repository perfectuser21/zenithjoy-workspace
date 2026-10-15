import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'retired-harvest-'));
  const dir = join(home, 'bin-harvest');
  mkdirSync(dir);
  for (const name of ['harvest-cron.sh', 'harvest-keyword.sh']) copyFileSync(join(source, name), join(dir, name));
  for (const name of ['harvest-fallback.sh', 'wf-run.sh', 'harvest-keyword-lib.sh']) {
    writeFileSync(join(dir, name), 'print -r -- reached >> "$HOME/legacy-side-effects"\n' + (name === 'harvest-keyword-lib.sh' ? '[[ -n "${HARVEST_KEYWORD_LIB:-}" ]] || exit 73\n' : ''));
  }
  return { home, dir };
}

for (const [entry, code, lib] of [
  ['harvest-cron.sh', 'HARVEST_CRON_RETIRED', 'HARVEST_CRON_LIB'],
  ['harvest-keyword.sh', 'HARVEST_KEYWORD_RETIRED', 'HARVEST_KEYWORD_LIB'],
]) {
  for (const testing of ['0', '1']) test(`${entry}: 正式旧入口在依赖、拿锁和手机动作之前退役（TESTING=${testing}）`, () => {
    const { home, dir } = fixture();
    try {
      const env = { ...process.env, HOME: home, HARVEST_KEYWORD_TESTING: testing };
      delete env.HARVEST_CRON_LIB;
      delete env.HARVEST_KEYWORD_LIB;
      const r = spawnSync('/bin/zsh', [join(dir, entry), 'profile', 'keyword', '1', 'tag'], { env, encoding: 'utf8', timeout: 3000 });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, new RegExp(code));
      assert.equal(existsSync(join(home, 'legacy-side-effects')), false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  test(`${entry}: 保留显式source库合同，不把库加载当作已退役业务执行`, () => {
    const { home, dir } = fixture();
    try {
      const env = { ...process.env, HOME: home, [lib]: '1' };
      const r = spawnSync('/bin/zsh', ['-c', 'source "$1" profile keyword 1 tag', 'library-test', join(dir, entry)], { env, encoding: 'utf8', timeout: 3000 });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(join(home, 'legacy-side-effects')), true);
      assert.doesNotMatch(r.stderr, /RETIRED/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}
