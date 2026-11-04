import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'android-cancel-cleanup-'));
  try {
    copyFileSync(resolve('.github/workflows/scripts/smoke/line02-android-cancel-candidate-cleanup.sh'), join(dir, 'cleanup.sh'));
    writeFileSync(join(dir, 'adb'), '#!/bin/sh\necho "adb $*" >> "$CLEANUP_LOG"\nexit "${ADB_FIXTURE_EXIT:-0}"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'psql'), '#!/bin/sh\necho "psql $*" >> "$CLEANUP_LOG"\ncat >/dev/null\n[ "${PSQL_FIXTURE_EXIT:-0}" = 0 ] || exit "$PSQL_FIXTURE_EXIT"\ncase "$*" in *-Atq*) echo "${RESIDUAL_FIXTURE-0}";; esac\n', { mode: 0o755 });
    const env = { PATH: `${dir}:/usr/bin:/bin`, CLEANUP_LOG: join(dir, 'calls.log'), RUNNER_TEMP: dir };
    run({ dir, env, execute: extra => spawnSync('bash', [join(dir, 'cleanup.sh')], { env: { ...env, ...extra }, encoding: 'utf8' }), calls: () => readFileSync(env.CLEANUP_LOG, 'utf8') });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const tenant = 'aaaaaaaa-1111-2222-3333-444444444444';
test('empty environment cannot report successful cleanup', () => fixture(({ execute }) => {
  const r = execute({}); assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /PASS:/);
}));
test('failed adb does not hide DB cleanup, and final result remains failed', () => fixture(({ dir, execute, calls }) => {
  const r = execute({ ADB: join(dir, 'adb'), ADB_FIXTURE_EXIT: '9', E2E_DATABASE_URL: 'fixture://db', E2E_TENANT_ID: tenant });
  assert.notEqual(r.status, 0); assert.match(calls(), /uninstall/); assert.match(calls(), /psql/); assert.doesNotMatch(r.stdout, /PASS:/);
}));
test('failed SQL is fatal even if later residual output would be zero', () => fixture(({ execute }) => {
  const r = execute({ E2E_DATABASE_URL: 'fixture://db', E2E_TENANT_ID: tenant, PSQL_FIXTURE_EXIT: '7' });
  assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /PASS:/);
}));
test('nonzero or malformed residual count cannot report success', () => fixture(({ execute }) => {
  for (const residual of ['1', '', 'n/a']) {
    const r = execute({ E2E_DATABASE_URL: 'fixture://db', E2E_TENANT_ID: tenant, RESIDUAL_FIXTURE: residual });
    assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /PASS:/);
  }
}));
test('valid DB cleanup uses the same nil-license fallback for delete and readback', () => fixture(({ execute, calls }) => {
  const r = execute({ E2E_DATABASE_URL: 'fixture://db', E2E_TENANT_ID: tenant });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /PASS:/);
  assert.equal((calls().match(/license_id=00000000-0000-0000-0000-000000000000/g) ?? []).length, 2);
}));
test('production package override is rejected before adb', () => fixture(({ dir, execute }) => {
  const r = execute({ ADB: join(dir, 'adb'), AGENT_PACKAGE: 'com.zenithjoy.agent' });
  assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /PASS:/);
}));
test('accessibility restore failure remains fatal while remaining cleanup runs', () => fixture(({ dir, execute, calls }) => {
  writeFileSync(join(dir, 'r16-accessibility-services-before.txt'), 'fixture');
  writeFileSync(join(dir, 'line02-android-accessibility-ui.sh'), '#!/bin/sh\necho restore >> "$CLEANUP_LOG"\nexit 8\n', { mode: 0o755 });
  const r = execute({ ADB: join(dir, 'adb') });
  assert.notEqual(r.status, 0); assert.match(calls(), /restore/); assert.match(calls(), /uninstall/); assert.doesNotMatch(r.stdout, /PASS:/);
}));
