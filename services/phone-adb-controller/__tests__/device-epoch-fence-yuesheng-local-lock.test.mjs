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
const locator = '127.0.0.1:15555';
const held = holder => `lock=held owner=${holder} age=1s stale=false reclaimable=false ttl=1800s\n`;
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
  const locked = { old: false, physical: false };
  const paths = new Map();
  const invoke = async (program, args, options) => {
    assert.equal(program, '/bin/zsh');
    assert.deepEqual(args.slice(0, 3), [controllerPath, '--profile', profile]);
    assert.equal(options.env.DOUYIN_ADB_BIN, '/usr/bin/false');
    assert.ok(!Object.hasOwn(options.env, 'DOUYIN_PHONE_LOCK_ROOT'));
    const path = options.env.DOUYIN_PHONE_REGISTRY;
    assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const text = readFileSync(path, 'utf8');
    const observed = text.split('\n')[1]?.split('\t');
    const lock = observed?.[1] === locator ? 'old' : 'physical';
    const address = lock === 'old' ? locator : serial;
    const holder = lock === 'old' ? owner + '-legacy' : owner;
    assert.deepEqual(observed, [profile, address, 'lock-only', '1', '1', 'true']);
    assert.doesNotMatch(text, /private-fixture/);
    if (!paths.has(lock)) paths.set(lock, path);
    assert.equal(paths.get(lock), path);
    assert.equal(new Set(paths.values()).size, paths.size);
    const command = args[3];
    calls.push(lock + ':' + command);
    if (command !== 'lock-status') assert.deepEqual(args.slice(4), [holder]);
    const override = behavior?.({ command, count: calls.length, lock, holder, locked });
    if (override !== undefined) return override;
    let stdout;
    if (command === 'lock-status') stdout = locked[lock] ? held(holder) : 'lock=free\n';
    else if (command === 'lock-acquire-new') {
      locked[lock] = true;
      stdout = `run_claim=recorded owner=${holder}\nlock=acquired owner=${holder}\nlock_evidence_id=${holder}-lock-acquire lock_evidence=/private/tmp/openclaw-phone/evidence/${profile}/${holder}-lock-acquire.json readback_state=held\n`;
    } else if (command === 'lock-release-exact') {
      locked[lock] = false;
      stdout = `lock=released owner=${holder}\nlock_evidence_id=${holder}-lock-release lock_evidence=/private/tmp/openclaw-phone/evidence/${profile}/${holder}-lock-release.json readback_state=free\n`;
    } else assert.fail(command);
    return { stdout, stderr: '' };
  };
  return { withDeviceGuard: createYueshengLocalDeviceGuard({ controllerPath, manifest, owner, invoke }), calls, result,
    root, locked: () => ({ ...locked }), registryPaths: () => [...paths.values()] };
}

test('checks both free before acquiring both in order and releases exact owners after observation', async t => {
  const f = setup(t);
  assert.deepEqual(await f.withDeviceGuard(serial, async guard => {
    assert.deepEqual(f.locked(), { old: true, physical: true });
    await guard.assertHeld();
    return f.result;
  }), f.result);
  assert.deepEqual(f.calls.slice(0, 4), ['old:lock-status', 'physical:lock-status',
    'old:lock-acquire-new', 'physical:lock-acquire-new']);
  assert.deepEqual(f.calls.filter(call => call.endsWith('release-exact')),
    ['old:lock-release-exact', 'physical:lock-release-exact']);
  assert.deepEqual(f.locked(), { old: false, physical: false });
  for (const path of f.registryPaths()) assert.throws(() => statSync(path), { code: 'ENOENT' });
});

test('preserves both locks and the original error when callback fails', async t => {
  const f = setup(t);
  const failure = Error('fixture application failed');
  await assert.rejects(f.withDeviceGuard(serial, async () => { throw failure; }), error => error === failure);
  assert.deepEqual(f.locked(), { old: true, physical: true });
  assert.equal(f.calls.some(call => call.endsWith('release-exact')), false);
});

test('does not acquire if the exact serial or either idle lock cannot be confirmed', async t => {
  const wrong = setup(t);
  await assert.rejects(wrong.withDeviceGuard(locator, () => wrong.result), { code: 'YUESHENG_MIGRATION_LOCAL_SCOPE' });
  assert.deepEqual(wrong.calls, []);
  const blocked = setup(t, ({ command, lock }) => command === 'lock-status' && lock === 'physical'
    ? { stdout: held(owner), stderr: '' } : undefined);
  await assert.rejects(blocked.withDeviceGuard(serial, () => blocked.result), { code: 'YUESHENG_MIGRATION_LOCAL_NOT_FREE' });
  assert.deepEqual(blocked.calls, ['old:lock-status', 'physical:lock-status']);
});

test('a callback that catches a failed exact guard check on either lock cannot release afterward', async t => {
  for (const which of ['old', 'physical']) {
    let checkInCallback = false;
    const f = setup(t, ({ command, lock, holder }) => checkInCallback && command === 'lock-status' && lock === which
      ? { stdout: held(holder + '-a1'), stderr: '' } : undefined);
    await assert.rejects(f.withDeviceGuard(serial, async guard => {
      checkInCallback = true;
      await assert.rejects(guard.assertHeld(), { code: 'YUESHENG_MIGRATION_LOCAL_HELD_UNKNOWN' });
      return f.result;
    }), { code: 'YUESHENG_MIGRATION_LOCAL_HELD_UNKNOWN' });
    assert.deepEqual(f.locked(), { old: true, physical: true });
    assert.equal(f.calls.some(call => call.endsWith('release-exact')), false);
  }
});

test('an ambiguous second acquisition preserves both claims and never starts the callback', async t => {
  const f = setup(t, ({ command, lock, holder, locked }) => {
    if (command !== 'lock-acquire-new' || lock !== 'physical') return undefined;
    locked.physical = true;
    return { stdout: `lock=acquired owner=${holder}\nlock_evidence_id=none reason=receipt_write_failed\n`, stderr: '' };
  });
  await assert.rejects(f.withDeviceGuard(serial, () => assert.fail('must not enter callback')),
    { code: 'YUESHENG_MIGRATION_LOCAL_ACQUIRE_UNKNOWN' });
  assert.deepEqual(f.calls.slice(0, 4), ['old:lock-status', 'physical:lock-status',
    'old:lock-acquire-new', 'physical:lock-acquire-new']);
  assert.deepEqual(f.locked(), { old: true, physical: true });
  assert.equal(f.calls.some(call => call.endsWith('release-exact')), false);
});

test('rejects candidate bytes that changed and does not invoke the controller', async t => {
  const f = setup(t);
  writeFileSync(join(f.root, 'config/collection-phone-hosts.json'), '{}');
  await assert.rejects(f.withDeviceGuard(serial, () => f.result), { code: 'YUESHENG_MIGRATION_LOCAL_CANDIDATE' });
  assert.deepEqual(f.calls, []);
});

test('unscoped observations and multiline owner readback never release a lock', async t => {
  const incomplete = setup(t);
  await assert.rejects(incomplete.withDeviceGuard(serial, () => ({ ...incomplete.result,
    observation: { ...incomplete.result.observation, new_endpoint: 'tcp:127.0.0.1:5046' } })),
  { code: 'YUESHENG_MIGRATION_LOCAL_RESULT_UNKNOWN' });
  assert.deepEqual(incomplete.locked(), { old: true, physical: true });
  const multiline = setup(t, ({ command, lock, holder, locked }) => command === 'lock-status' && lock === 'old' && locked.old
    ? { stdout: held(holder) + '\n', stderr: '' } : undefined);
  await assert.rejects(multiline.withDeviceGuard(serial, () => assert.fail('must not enter callback')),
    { code: 'YUESHENG_MIGRATION_LOCAL_HELD_UNKNOWN' });
  assert.deepEqual(multiline.locked(), { old: true, physical: true });
  assert.equal(multiline.calls.some(call => call.endsWith('release-exact')), false);
});

test('an ambiguous old release is not retried and prevents physical release', async t => {
  const f = setup(t, ({ command, lock }) => command === 'lock-release-exact' && lock === 'old'
    ? { stdout: 'lock=free\n', stderr: '' } : undefined);
  await assert.rejects(f.withDeviceGuard(serial, () => f.result), { code: 'YUESHENG_MIGRATION_LOCAL_RELEASE_UNKNOWN' });
  assert.deepEqual(f.calls.filter(call => call.endsWith('release-exact')), ['old:lock-release-exact']);
  assert.equal(f.locked().physical, true);
});
