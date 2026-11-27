import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

test('受管账号入口遇到 dump 返回 0 但页面一直不空闲，只探测一次并请 Agent 截图定位', t => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zj-account-entry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const registry = join(dir, 'profiles.tsv'), adb = join(dir, 'fake-adb'), log = join(dir, 'adb.log');
  writeFileSync(registry, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  writeFileSync(adb, fakeAdb.replace('  *) exit 98 ;;', `  *'shell uiautomator dump'*) echo 'ERROR: could not get idle state.' >&2; exit 0 ;;
  *'shell rm -f'*) exit 0 ;;
  *'shell stat -c %s'*) for path in "$@"; do :; done; printf "stat: '%s': No such file or directory\\n" "$path" >&2; exit 1 ;;
  *REMOTE_UI_ABSENT_V1*) printf '%s' REMOTE_UI_ABSENT_V1 ;;
  *) exit 98 ;;`), { mode: 0o755 });
  const env = { ...process.env, ...fixturePythonEnv({ DOUYIN_PYTHON_BIN: '/usr/bin/python3' }),
    ...phoneLockFixtureEnv(registry, join(dir, 'phone')), DOUYIN_ADB_BIN: fixtureAdb(adb),
    HOME: dir, ADB_LOG: log, APP_FOREGROUND: 'yes' };
  const run = (...argv) => spawnSync('zsh', [controller, '--profile', 'legacy', ...argv], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(run('lock-acquire-new', 'entry').status, 0);
  const reply = run('--lock-owner', 'entry', 'account-current', 'entry-first', '--single-dump');
  assert.equal(reply.status, 0, reply.stderr + readFileSync(log, 'utf8'));
  assert.equal(reply.stdout.trim(), 'account_status=visual_required');
  const calls = readFileSync(log, 'utf8');
  assert.equal((calls.match(/shell uiautomator dump/g) ?? []).length, 1);
  assert.doesNotMatch(calls, /input tap/);
});

test('账号视觉操作拒绝未取证、非「我」区域及错前台，复核失败不会再点', t => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zj-account-nav-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const registry = join(dir, 'profiles.tsv'), adb = join(dir, 'fake-adb'), log = join(dir, 'adb.log');
  writeFileSync(registry, 'legacy\tSER1\tANY-MODEL\t720\t1280\n');
  writeFileSync(adb, fakeAdb.replace('  *) exit 98 ;;', `  *'shell rm -f'*) exit 0 ;;
  *'shell uiautomator dump'*) exit 0 ;;
  *'shell stat -c %s'*) echo 104 ;;
  *' pull '*) for path in "$@"; do :; done; printf '%s' '<hierarchy><node content-desc="我，按钮" bounds="[600,1100][700,1200]"/></hierarchy>' > "$path" ;;
  *) exit 98 ;;`), { mode: 0o755 });
  const phoneRoot = join(dir,'phone'), proof = join(phoneRoot,'evidence','legacy');
  const env = { ...process.env, ...fixturePythonEnv({ DOUYIN_PYTHON_BIN: '/usr/bin/python3' }),
    ...phoneLockFixtureEnv(registry,phoneRoot), DOUYIN_ADB_BIN:fixtureAdb(adb), HOME:dir, ADB_LOG:log, APP_FOREGROUND:'yes' };
  const run = (foreground,...argv) => spawnSync('zsh',[controller,'--profile','legacy',...argv],
    { env:{...env,APP_FOREGROUND:foreground},encoding:'utf8',timeout:15000 });
  assert.equal(run('yes','lock-acquire-new','entry').status,0);
  const tap=(focused,x,y)=>run(focused,'--lock-owner','entry','account-visual-tap',String(x),String(y),'entry-screen','entry-tap');
  assert.match(tap('yes',648,1173).stderr,/requires this run/);
  mkdirSync(proof,{recursive:true});
  writeFileSync(join(proof,'entry-screen.png'),'native screenshot fixture');
  assert.match(tap('yes',680,800).stderr,/outside the Me tab area/);
  assert.match(tap('no',648,1173).stderr,/no longer the active window/);
  const readback=run('yes','--lock-owner','entry','account-current','entry-verify','--verify-own-profile');
  assert.equal(readback.status,0,readback.stderr);
  assert.equal(readback.stdout.trim(),'account_status=own_profile_unverified');
  assert.doesNotMatch(readFileSync(log,'utf8'),/input tap/);
});
