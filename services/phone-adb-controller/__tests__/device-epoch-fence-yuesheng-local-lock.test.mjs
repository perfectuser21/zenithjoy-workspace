import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { digest } from '../device-epoch-fence-reference.mjs';
import { createYueshengLocalDeviceGuard } from '../device-epoch-fence-yuesheng-local-lock.mjs';

const owner = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const serial = 'B114E2190975';
const profile = 'wuying_android14';
const held = `lock=held owner=${owner} age=1s stale=false reclaimable=false ttl=1800s\n`;
const members = ['douyin-phone-adb', 'phone-lock-lib.sh', 'phone-lock-root.py', 'phone-lock-helper.py', 'config/collection-phone-hosts.json'];

function setup(t, behavior) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'yuesheng-lock-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerPath = join(root, 'douyin-phone-adb');
  mkdirSync(join(root, 'config'), { mode: 0o700 });
  const file = name => name.endsWith('.json')
    ? JSON.stringify({ version: 1, hosts: [{ target: 'mmv', profile, serial, expected_account: 'private-fixture' }] })
    : `frozen fixture for ${name}\n`;
  const files = members.map(name => {
    const contents = file(name);
    writeFileSync(join(root, name), contents, { mode: 0o600 });
    return { deployed_path: name, path: 'services/phone-adb-controller/' + name, content_sha256: digest(contents) };
  });
  const manifest = {
    target: 'mmv', source_repo: 'perfectuser21/zenithjoy-workspace', source_commit: 'a'.repeat(40),
    environment: 'staging:' + 'a'.repeat(40), release_id: '0ce2ea9d-c226-44d0-9cf0-18d5aa548970',
    observation_id: '9388e0c6-dd11-497e-ae76-9ed9ab7fe390', files,
  };
  const result = { protocol: 'yuesheng-adb-migration-transaction/v1', status: 'observed', plan_sha256: 'b'.repeat(64),
    observation: { protocol: 'yuesheng-adb-migration-observation/v1', authorization: 'none', task_id: owner,
      source_commit: manifest.source_commit, release_id: manifest.release_id, observation_id: manifest.observation_id,
      physical_serial: serial, transport_serial: '127.0.0.1:15555', old_endpoint: 'tcp:127.0.0.1:5044',
      new_endpoint: 'tcp:127.0.0.1:5045', readback_sha256: 'c'.repeat(64) } };
  const calls = [];
  let locked = false;
  let tsvPath;
  const invoke = async (program, args, options) => {
    assert.equal(program, '/bin/zsh');
    assert.deepEqual(args.slice(0, 3), [controllerPath, '--profile', profile]);
    assert.equal(options.env.DOUYIN_ADB_BIN, '/usr/bin/false');
    assert.ok(!Object.hasOwn(options.env, 'DOUYIN_PHONE_LOCK_ROOT'));
    tsvPath ??= options.env.DOUYIN_PHONE_REGISTRY;
    assert.equal(tsvPath, options.env.DOUYIN_PHONE_REGISTRY);
    assert.equal(statSync(dirname(tsvPath)).mode & 0o777, 0o700);
    assert.equal(statSync(tsvPath).mode & 0o777, 0o600);
    assert.match(readFileSync(tsvPath, 'utf8'), /wuying_android14\tB114E2190975\tlock-only\t1\t1\ttrue\n$/);
    assert.doesNotMatch(readFileSync(tsvPath, 'utf8'), /private-fixture/);
    const command = args[3];
    calls.push(command);
    if (command !== 'lock-status') assert.deepEqual(args.slice(4), [owner]);
    const override = behavior?.({ command, count: calls.length });
    if (override !== undefined) return override;
    let stdout;
    if (command === 'lock-status') stdout = locked ? held : 'lock=free\n';
    else if (command === 'lock-acquire-new') {
      locked = true;
      stdout = `run_claim=recorded owner=${owner}\nlock=acquired owner=${owner}\nlock_evidence_id=${owner}-lock-acquire lock_evidence=/private/tmp/openclaw-phone/evidence/${profile}/${owner}-lock-acquire.json readback_state=held\n`;
    } else if (command === 'lock-release-exact') {
      locked = false;
      stdout = `lock=released owner=${owner}\nlock_evidence_id=${owner}-lock-release lock_evidence=/private/tmp/openclaw-phone/evidence/${profile}/${owner}-lock-release.json readback_state=free\n`;
    } else assert.fail(command);
    return { stdout, stderr: '' };
  };
  return { withDeviceGuard: createYueshengLocalDeviceGuard({ controllerPath, manifest, owner, invoke }), calls, result,
    root, locked: () => locked, registryPath: () => tsvPath };
}

test('takes a persistent claim and releases the exact owner after the scoped observed callback', async t => {
  const f = setup(t);
  assert.deepEqual(await f.withDeviceGuard(serial, async guard => {
    assert.equal(f.locked(), true);
    await guard.assertHeld();
    return f.result;
  }), f.result);
  assert.deepEqual(f.calls, ['lock-status', 'lock-acquire-new', 'lock-status', 'lock-status', 'lock-status',
    'lock-release-exact', 'lock-status']);
  assert.equal(f.locked(), false);
  assert.throws(() => statSync(f.registryPath()), { code: 'ENOENT' });
});

test('preserves the acquired lock and original error when callback fails', async t => {
  const f = setup(t);
  const failure = Error('fixture application failed');
  await assert.rejects(f.withDeviceGuard(serial, async () => { throw failure; }), error => error === failure);
  assert.equal(f.locked(), true);
  assert.deepEqual(f.calls, ['lock-status', 'lock-acquire-new', 'lock-status']);
});

test('does not acquire if the exact serial or the idle lock cannot be confirmed', async t => {
  const wrong = setup(t);
  await assert.rejects(wrong.withDeviceGuard('127.0.0.1:15555', () => wrong.result),
    { code: 'YUESHENG_MIGRATION_LOCAL_SCOPE' });
  assert.deepEqual(wrong.calls, []);
  const blocked = setup(t, ({ command }) => command === 'lock-status' ? { stdout: held, stderr: '' } : undefined);
  await assert.rejects(blocked.withDeviceGuard(serial, () => blocked.result), { code: 'YUESHENG_MIGRATION_LOCAL_NOT_FREE' });
  assert.deepEqual(blocked.calls, ['lock-status']);
});

test('a callback that catches a failed exact guard check cannot release afterward', async t => {
  const f = setup(t, ({ count }) => count === 4
    ? { stdout: held.replace(`owner=${owner} `, `owner=${owner}-a1 `), stderr: '' } : undefined);
  await assert.rejects(f.withDeviceGuard(serial, async guard => {
    await assert.rejects(guard.assertHeld(), { code: 'YUESHENG_MIGRATION_LOCAL_HELD_UNKNOWN' });
    return f.result;
  }), { code: 'YUESHENG_MIGRATION_LOCAL_HELD_UNKNOWN' });
  assert.equal(f.locked(), true);
  assert.equal(f.calls.includes('lock-release-exact'), false);
});

test('false capture receipts and non-observed results preserve the lock boundary', async t => {
  const incomplete = setup(t, ({ command }) => command === 'lock-acquire-new'
    ? { stdout: `lock=acquired owner=${owner}\nlock_evidence_id=none reason=receipt_write_failed\n`, stderr: '' } : undefined);
  await assert.rejects(incomplete.withDeviceGuard(serial, () => assert.fail('must not enter callback')),
    { code: 'YUESHENG_MIGRATION_LOCAL_ACQUIRE_UNKNOWN' });
  assert.deepEqual(incomplete.calls, ['lock-status', 'lock-acquire-new']);
  const ambiguous = setup(t);
  await assert.rejects(ambiguous.withDeviceGuard(serial, () => ({ ...ambiguous.result, status: 'unknown' })),
    { code: 'YUESHENG_MIGRATION_LOCAL_RESULT_UNKNOWN' });
  assert.equal(ambiguous.locked(), true);
  assert.equal(ambiguous.calls.includes('lock-release-exact'), false);
});

test('rejects candidate bytes that changed and does not invoke the controller', async t => {
  const f = setup(t);
  writeFileSync(join(f.root, 'config/collection-phone-hosts.json'), '{}');
  await assert.rejects(f.withDeviceGuard(serial, () => f.result), { code: 'YUESHENG_MIGRATION_LOCAL_CANDIDATE' });
  assert.deepEqual(f.calls, []);
});
