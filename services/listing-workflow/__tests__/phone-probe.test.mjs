import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeReadOnly, readOnlyInvocation } from '../phone-probe.mjs';
import { createMerchantAdapter } from '../merchant-adapter.mjs';
import { coordinate } from '../coordinator.mjs';

// 本文件注入ADB/锁响应，仅验证控制与拒绝逻辑；真实手机采集由独立证据包验收。

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHfoAAAAASUVORK5CYII=', 'base64');
const xml = Buffer.from('<hierarchy><node package="com.xunmeng.merchant" text="商家端详情" bounds="[0,0][200,100]"/></hierarchy>');
function fixture(overrides = {}) {
  return { route: ['jump-host', 'operator@device-host'], serial: 'SERIAL123', expectedPackage: 'com.xunmeng.merchant', runId: 'probe-run', taskId: 'task-1', evidenceRoot: mkdtempSync(join(tmpdir(), 'phone-probe-')), ...overrides };
}
function deps(overrides = {}) {
  const calls = []; let owner = null;
  const brain = {
    acquire: async (serial, who) => { calls.push('acquire'); owner = who; return { acquired: true }; },
    lease: async () => ({ locked_by: owner, expired: false, expires_at: new Date(Date.now() + 7200000).toISOString(), serverTimeMs: Date.now(), networkElapsedMs: 0 }),
    release: async () => { calls.push('release'); owner = null; return { success: true }; },
  };
  return { calls, brain, deviceBinding: { serial: 'SERIAL123', route: ['jump-host', 'operator@device-host'], authority: 'explicit-user-task' }, sleep: async () => {}, run: async operation => {
    calls.push(operation);
    const out = { online: 'device', identity: 'SERIAL123', foreground: 'mCurrentFocus=Window{a u0 com.xunmeng.merchant/.Page}', telephony: 'mCallState=0\nmCallState=0', dump: 'dumped', xml, screenshot: png, cleanup: '', artifact_absent: '' }[operation];
    return { status: 0, stdout: Buffer.isBuffer(out) ? out : Buffer.from(out), stderr: Buffer.alloc(0) };
  }, ...overrides };
}

test('transport command builder restricts operations and safely quotes SSH routing', () => {
  const config = fixture();
  const invocation = readOnlyInvocation(config, 'screenshot', '/sdcard/probe.xml');
  assert.equal(invocation.command, 'ssh');
  assert.ok(invocation.args.at(-1).includes('screencap'));
  assert.throws(() => readOnlyInvocation(config, 'tap', '/sdcard/probe.xml'), /FORBIDDEN_OPERATION/);
  assert.throws(() => readOnlyInvocation({ ...config, route: ['host;touch /tmp/injected'] }, 'screenshot'), /INVALID_ROUTE/);
  assert.throws(() => readOnlyInvocation({ ...config, serial: 'x;reboot' }, 'screenshot'), /INVALID_SERIAL/);
});

test('probe saves screenshot, tree and hashes, returns observation and verifies own lock release', async () => {
  const config = fixture(), d = deps();
  const result = await probeReadOnly(config, d);
  assert.equal(result.status, 'observed');
  assert.equal(result.requiresVisualReview, true);
  assert.equal(result.lockReleased, true);
  assert.equal(readFileSync(result.screenshot).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const manifest = JSON.parse(readFileSync(result.manifest));
  assert.equal(manifest.runId, config.runId);
  assert.ok(manifest.files.every(f => f.sha256.length === 64));
  assert.equal(d.calls.at(-1), 'release');
});

test('busy device makes no ADB calls', async () => {
  const d = deps(); d.brain.acquire = async () => ({ acquired: false });
  await assert.rejects(probeReadOnly(fixture(), d), /DEVICE_BUSY/);
  assert.deepEqual(d.calls, []);
});

test('unexpected app is diagnosed locally, never dumps private UI tree and releases lock', async () => {
  const d = deps(), original = d.run;
  d.run = async op => op === 'foreground' ? { status: 0, stdout: Buffer.from('mCurrentFocus=Window{a u0 com.tencent.mm/.Chat}'), stderr: Buffer.alloc(0) } : original(op);
  await assert.rejects(probeReadOnly(fixture(), d), /WRONG_FOREGROUND/);
  assert.equal(d.calls.includes('dump'), false);
  assert.equal(d.calls.at(-1), 'release');
});

test('ongoing call stops before UI capture', async () => {
  const d = deps(), original = d.run;
  d.run = async op => op === 'telephony' ? { status: 0, stdout: Buffer.from('mCallState=2'), stderr: Buffer.alloc(0) } : original(op);
  await assert.rejects(probeReadOnly(fixture(), d), /CALL_ACTIVE/);
  assert.equal(d.calls.includes('dump'), false);
  assert.equal(d.calls.at(-1), 'release');
});

test('app switch during capture prevents successful observation', async () => {
  const d = deps(), original = d.run; let focus = 0;
  d.run = async op => op === 'foreground' && ++focus > 1 ? { status: 0, stdout: Buffer.from('mCurrentFocus=Window{a u0 com.tencent.mm/.Chat}'), stderr: Buffer.alloc(0) } : original(op);
  await assert.rejects(probeReadOnly(fixture(), d), /WRONG_FOREGROUND/);
  assert.equal(d.calls.at(-1), 'release');
});

test('broken screenshot and failed cleanup cannot be reported as success', async () => {
  const d = deps(), original = d.run;
  d.run = async op => op === 'screenshot' ? { status: 0, stdout: Buffer.from('ssh banner'), stderr: Buffer.alloc(0) } : original(op);
  await assert.rejects(probeReadOnly(fixture(), d), /INVALID_SCREENSHOT/);
  const blocked = deps(); blocked.brain.release = async () => ({ success: false });
  await assert.rejects(probeReadOnly(fixture(), blocked), /LOCK_RELEASE_UNCONFIRMED/);
});

test('reusing a run ID creates separate evidence directories without overwriting', async () => {
  const config = fixture();
  const a = await probeReadOnly(config, deps()), b = await probeReadOnly(config, deps());
  assert.notEqual(a.manifest, b.manifest);
  assert.equal(readdirSync(config.evidenceRoot).length, 2);
});

test('merchant adapter rejects missing business facts before invoking capture or submit', async () => {
  let captures = 0;
  const a = createMerchantAdapter({ probe: async () => { captures++; } });
  const result = await a.validate({ target: { store: 'shop' }, payload: {} });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('SUPPLY_UNVERIFIED'));
  assert.ok(result.reasons.includes('PROMOTIONS_UNVERIFIED'));
  assert.equal(captures, 0);
  await assert.rejects(a.submit({}), /SUBMISSION_DRIVER_UNAVAILABLE/);
});

test('controlled capture remains unknown until trusted visual review, not fake verified', async () => {
  const a = createMerchantAdapter({ probe: () => probeReadOnly(fixture(), deps()) });
  const result = await a.lookup({ businessKey: 'request', intentId: 'intent', fingerprint: 'digest' });
  assert.equal(result.state, 'unknown');
  assert.equal(result.observation.status, 'observed');
  assert.equal(result.requiresVisualReview, true);
});

test('probe CLI help has no device side effects and validation refuses incomplete plans', () => {
  const cli = new URL('../phone-probe-cli.mjs', import.meta.url).pathname;
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes('只读'));
  const f = fixture(), request = join(f.evidenceRoot, 'request.json');
  writeFileSync(request, JSON.stringify({ target: { store: 'shop' }, payload: {} }));
  const rejected = spawnSync(process.execPath, [cli, 'validate', request], { encoding: 'utf8' });
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).ok, false);
});

test('lost acquire response is reconciled by owner readback before cleanup', async () => {
  const d = deps(), acquire = d.brain.acquire;
  d.brain.acquire = async (...args) => { await acquire(...args); throw new Error('LOCK_RESPONSE_LOST'); };
  await assert.rejects(probeReadOnly(fixture(), d), /LOCK_RESPONSE_LOST/);
  assert.equal(d.calls.includes('online'), false);
  assert.equal(d.calls.at(-1), 'release');
});

test('caller cannot switch the serial after acquiring a different device lock', async () => {
  const config = fixture(), d = deps(), acquire = d.brain.acquire;
  d.brain.acquire = async (...args) => { const result = await acquire(...args); config.serial = 'OTHERDEVICE'; return result; };
  const result = await probeReadOnly(config, d);
  assert.equal(JSON.parse(readFileSync(result.manifest)).serial, 'SERIAL123');
});

test('dump retries use fresh remote filenames and wait before the second attempt', async () => {
  const d = deps(), original = d.run, paths = []; let waits = 0;
  d.sleep = async () => { waits++; };
  d.run = async (op, invocation) => {
    if (op === 'dump') { paths.push(invocation.args.at(-1)); if (paths.length === 1) return { status: 1, stdout: Buffer.alloc(0) }; }
    return original(op);
  };
  await probeReadOnly(fixture(), d);
  assert.equal(paths.length, 2); assert.equal(waits, 1); assert.notEqual(paths[0], paths[1]);
});

test('expired or insufficient lease never authorizes any ADB command', async () => {
  for (const delta of [-1, 1000]) {
    const d = deps(), lease = d.brain.lease;
    d.brain.lease = async () => ({ ...await lease(), expired: delta < 0, expires_at: new Date(Date.now() + delta).toISOString() });
    await assert.rejects(probeReadOnly(fixture(), d), /LEASE_UNSAFE/);
    assert.equal(d.calls.includes('online'), false);
  }
});

test('device binding mismatch is rejected before locking and hardware serial is checked', async () => {
  const d = deps();
  await assert.rejects(probeReadOnly(fixture({ route: ['different-host'] }), d), /DEVICE_BINDING_MISMATCH/);
  assert.deepEqual(d.calls, []);
  const wrong = deps(), original = wrong.run;
  wrong.run = async op => op === 'identity' ? { status: 0, stdout: Buffer.from('OTHER') } : original(op);
  await assert.rejects(probeReadOnly(fixture(), wrong), /DEVICE_IDENTITY_MISMATCH/);
});

test('SSH timeout preserves lock until remote termination is reconciled', async () => {
  const d = deps();
  d.run = async () => ({ status: null, error: { code: 'ETIMEDOUT' }, stdout: Buffer.alloc(0) });
  await assert.rejects(probeReadOnly(fixture(), d), /COMMAND_FAILED/);
  assert.equal(d.calls.includes('release'), false);
});

test('only this probe artifacts are deleted and absence is checked before release', async () => {
  const d = deps(), result = await probeReadOnly(fixture(), d);
  const manifest = JSON.parse(readFileSync(result.manifest));
  assert.deepEqual(manifest.remoteArtifactsRemaining, []);
  assert.ok(d.calls.includes('cleanup')); assert.ok(d.calls.includes('artifact_absent'));
  assert.ok(d.calls.indexOf('cleanup') < d.calls.indexOf('release'));
  assert.throws(() => readOnlyInvocation(fixture(), 'cleanup', '/sdcard/private.xml'), /INVALID_ARTIFACT_PATH/);
});

test('untrusted lease clock and thrown SSH errors cannot release an unresolved remote reader', async () => {
  const d = deps(), lease = d.brain.lease;
  d.brain.lease = async () => ({ ...await lease(), serverTimeMs: NaN });
  await assert.rejects(probeReadOnly(fixture(), d), /LEASE_UNSAFE/);
  assert.equal(d.calls.includes('online'), false);
  const uncertain = deps(); uncertain.run = async () => { throw new Error('SSH disconnected'); };
  await assert.rejects(probeReadOnly(fixture(), uncertain), /COMMAND_FAILED/);
  assert.equal(uncertain.calls.includes('release'), false);
});

test('request cannot redirect the lock authority and binding metadata is immutable', async () => {
  const d = deps();
  await assert.rejects(probeReadOnly(fixture({ brainBaseUrl: 'http://untrusted.example' }), d), /DEVICE_BINDING_MISMATCH/);
  assert.deepEqual(d.calls, []);
  const immutable = deps(), acquire = immutable.brain.acquire;
  immutable.brain.acquire = async (...args) => { immutable.deviceBinding.authority = 'changed'; return acquire(...args); };
  const result = await probeReadOnly(fixture(), immutable);
  assert.equal(JSON.parse(readFileSync(result.manifest)).deviceBindingAuthority, 'explicit-user-task');
});

test('device state response evidence is retained without copying private telephony registry', async () => {
  const result = await probeReadOnly(fixture(), deps());
  const manifest = JSON.parse(readFileSync(result.manifest));
  const identity = manifest.files.find(file => file.name.endsWith('-identity.txt'));
  assert.ok(identity); assert.equal(readFileSync(identity.path, 'utf8'), 'SERIAL123');
  const telephony = manifest.files.find(file => file.name.endsWith('-telephony.txt'));
  assert.ok(telephony); assert.ok(readFileSync(telephony.path, 'utf8').includes('mCallState=0'));
});

test('coordinator cannot create a submit intent from an unverified merchant plan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merchant-rejection-')); let captures = 0;
  const a = createMerchantAdapter({ probe: async () => { captures++; } });
  await assert.rejects(coordinate({ root, businessKey: 'shop:request', runId: 'run', target: { store: 'shop' }, payload: {} }, a), /PRECONDITIONS_UNVERIFIED/);
  assert.equal(captures, 0); assert.deepEqual(readdirSync(root), []);
});
