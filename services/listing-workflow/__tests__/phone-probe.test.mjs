import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeReadOnly, readOnlyInvocation } from '../phone-probe.mjs';
import { createMerchantAdapter } from '../merchant-adapter.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHfoAAAAASUVORK5CYII=', 'base64');
const xml = Buffer.from('<hierarchy><node package="com.xunmeng.merchant" text="商家端详情" bounds="[0,0][200,100]"/></hierarchy>');
function fixture(overrides = {}) {
  return { route: ['jump-host', 'operator@device-host'], serial: 'SERIAL123', expectedPackage: 'com.xunmeng.merchant', runId: 'probe-run', taskId: 'task-1', evidenceRoot: mkdtempSync(join(tmpdir(), 'phone-probe-')), ...overrides };
}
function deps(overrides = {}) {
  const calls = []; let owner = null;
  const brain = {
    acquire: async (serial, who) => { calls.push('acquire'); owner = who; return { acquired: true }; },
    owner: async () => owner,
    release: async () => { calls.push('release'); owner = null; return { success: true }; },
  };
  return { calls, brain, sleep: async () => {}, run: async operation => {
    calls.push(operation);
    const out = { online: 'device', foreground: 'mCurrentFocus=Window{a u0 com.xunmeng.merchant/.Page}', telephony: 'mCallState=0\nmCallState=0', dump: 'dumped', xml, screenshot: png }[operation];
    return { status: 0, stdout: Buffer.isBuffer(out) ? out : Buffer.from(out), stderr: Buffer.alloc(0) };
  }, ...overrides };
}

test('real transport exposes only read-only operations and safely quotes SSH routing', () => {
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

test('real read-only capture remains unknown until trusted visual review, not fake verified', async () => {
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
