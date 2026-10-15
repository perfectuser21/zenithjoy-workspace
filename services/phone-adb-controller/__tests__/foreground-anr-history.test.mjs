import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const HISTORY = 'mCurrentFocus=Window{old u0 com.sina.weibo/.MainTabActivity}';
const LAUNCHER = 'mCurrentFocus=Window{live u0 com.android.launcher3/.Launcher}';

// Android saves the complete old window state in LAST ANR. Only the external
// adb boundary is faked; assertions exercise the real controller commands.
function run(command, current = LAUNCHER) {
  const dir = mkdtempSync(join(tmpdir(), 'foreground-anr-'));
  const registry = join(dir, 'profiles.tsv');
  const adb = join(dir, 'adb');
  writeFileSync(registry, 'legacy\tSER1\tANY-MODEL\t719\t1279\n');
  writeFileSync(join(dir, 'current.txt'), `${current}\n`);
  writeFileSync(join(dir, 'full.txt'), `LAST ANR STATE:\n${HISTORY}\nWINDOW MANAGER DISPLAY CONTENTS\n${current}\n`);
  writeFileSync(adb, `#!/bin/sh
case "$*" in
  *"get-state"*) echo device;;
  *"resolve-activity"*) echo 'packageName=com.android.launcher3';;
  *"dumpsys window displays"*) cat "$FOREGROUND_FIXTURE/current.txt";;
  *"dumpsys window"*) cat "$FOREGROUND_FIXTURE/full.txt";;
esac
`);
  chmodSync(adb, 0o755);
  try {
    return spawnSync('zsh', [SCRIPT, '--profile', 'legacy', command], {
      env: {
        ...process.env,
        DOUYIN_ADB_BIN: adb,
        DOUYIN_PHONE_REGISTRY: registry,
        DOUYIN_PHONE_TMP_ROOT: join(dir, 'phone'),
        FOREGROUND_FIXTURE: dir,
      },
      encoding: 'utf8',
      timeout: 15000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('foreground reports the live launcher instead of the earlier ANR app', () => {
  const result = run('foreground');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `foreground=${LAUNCHER}`);
});

test('safe desktop succeeds when current HOME is valid despite old ANR focus', () => {
  const result = run('return-safe-desktop');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^foreground_package=com\.android\.launcher3$/m);
});

test('a null live focus cannot be replaced with a historical ANR focus', () => {
  const result = run('foreground', 'mCurrentFocus=null\nmFocusedApp=null');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'foreground=');
});

test('the current focused app fallback remains available without a focused window', () => {
  const app = 'mFocusedApp=ActivityRecord{live u0 com.test.app/.MainActivity t1}';
  const result = run('foreground', `mCurrentFocus=null\n${app}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `foreground=${app}`);
});
