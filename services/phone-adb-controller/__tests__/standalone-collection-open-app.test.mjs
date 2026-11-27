import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureAdb, fixturePythonEnv } from './adb-existing-route.test.mjs';
import { phoneLockFixtureEnv } from './helpers/phone-lock-fixture.mjs';

const controller = fileURLToPath(new URL('../douyin-phone-adb', import.meta.url));
const fakeAdb = `#!/bin/sh
printf '%s\\n' "$*" >> "$ADB_LOG"
case "$*" in
  *get-state) echo device ;;
  *'getprop ro.product.model') echo ANY-MODEL ;;
  *monkey*) exit 0 ;;
  *'dumpsys window displays')
    echo 'mFocusedApp=ActivityRecord{ignored com.ss.android.ugc.aweme/.OldActivity}'
    if [ "$APP_FOREGROUND" = yes ]; then
      echo 'mCurrentFocus=Window{active u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.splash.SplashActivity}'
    else
      echo 'mCurrentFocus=Window{active u0 com.android.launcher3/.Launcher}'
    fi ;;
  *) exit 98 ;;
esac`;

for (const appForeground of [true, false]) {
  test(`带设备锁启动，应用在前台=${appForeground}，全程不取控件树`, t => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zj-collection-open-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const registry = join(dir, 'profiles.tsv'), adb = join(dir, 'fake-adb'), log = join(dir, 'adb.log');
    writeFileSync(registry, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
    writeFileSync(adb, fakeAdb, { mode: 0o755 });
    const env = { ...process.env, ...fixturePythonEnv({ DOUYIN_PYTHON_BIN: '/usr/bin/python3' }), ...phoneLockFixtureEnv(registry, join(dir, 'phone')),
      DOUYIN_ADB_BIN: fixtureAdb(adb), HOME: dir, ADB_LOG: log, APP_FOREGROUND: appForeground ? 'yes' : 'no' };
    const run = (...argv) => spawnSync('zsh', [controller, '--profile', 'legacy', ...argv], { env, encoding: 'utf8', timeout: 15000 });
    const acquired = run('lock-acquire-new', 'test-open');
    assert.equal(acquired.status, 0, acquired.stderr);
    const reply = run('--lock-owner', 'test-open', 'open-app', '--foreground-only');
    assert.equal(reply.status, 0, reply.stderr);
    assert.match(reply.stdout, new RegExp(appForeground ? '^open_app=app_foreground$' : '^open_app=foreground_timeout$', 'm'));
    const calls = readFileSync(log, 'utf8');
    assert.equal((calls.match(/shell monkey/g) ?? []).length, 1);
    assert.equal((calls.match(/dumpsys window displays/g) ?? []).length, appForeground ? 1 : 2);
    assert.doesNotMatch(calls, /uiautomator|screencap|\bpull\b|input tap/);
    assert.notEqual(run('open-app', '--foreground-only').status, 0);
  });
}
