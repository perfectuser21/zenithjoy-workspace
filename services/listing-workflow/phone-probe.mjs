import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const packagePattern = /^[a-z][a-z0-9_.]+$/;

export function readOnlyInvocation(config, operation, remotePath = '/sdcard/agent-probe.xml') {
  if (!idPattern.test(config.serial || '')) throw new Error('INVALID_SERIAL');
  if (!Array.isArray(config.route) || config.route.length > 4 || config.route.some(host => typeof host !== 'string' || !/^(?:[A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(host))) throw new Error('INVALID_ROUTE');
  if (!/^\/sdcard\/[A-Za-z0-9_.-]+\.xml$/.test(remotePath)) throw new Error('INVALID_REMOTE_PATH');
  const operations = {
    online: ['get-state'], foreground: ['shell', 'dumpsys', 'window'], telephony: ['shell', 'dumpsys', 'telephony.registry'],
    screenshot: ['exec-out', 'screencap', '-p'], dump: ['shell', 'uiautomator', 'dump', '--compressed', remotePath], xml: ['exec-out', 'cat', remotePath],
  };
  if (!Object.hasOwn(operations, operation)) throw new Error('FORBIDDEN_OPERATION');
  let tokens = ['adb', '-s', config.serial, ...operations[operation]];
  if (!config.route.length) return { command: tokens[0], args: tokens.slice(1) };
  for (let i = config.route.length - 1; i > 0; i--) tokens = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '--', config.route[i], tokens.map(quote).join(' ')];
  return { command: 'ssh', args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '--', config.route[0], tokens.map(quote).join(' ')] };
}

export function createBrainClient(baseUrl = 'http://localhost:5221') {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('INVALID_BRAIN_URL');
  async function request(path, body) {
    const response = await fetch(new URL(`/api/brain/device-locks${path}`, base), { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`LOCK_API_HTTP_${response.status}`);
    return response.json();
  }
  return {
    acquire: (serial, owner) => request('/acquire', { device_name: serial, locked_by: owner, ttl_minutes: 120 }),
    release: (serial, owner) => request('/release', { device_name: serial, locked_by: owner }),
    owner: async serial => {
      const data = await request('');
      const lock = data.locks?.find(value => value.device_name === serial);
      if (!lock) throw new Error('LOCK_RECORD_MISSING');
      return lock.locked_by;
    },
  };
}

function foregroundOf(bytes) {
  const matches = [...bytes.toString('utf8').matchAll(/mCurrentFocus=.*?\bu\d+\s+([A-Za-z0-9_.]+)\//g)];
  if (matches.length !== 1) throw new Error('FOREGROUND_UNCONFIRMED');
  return matches[0][1];
}
function validScreenshot(bytes) {
  return bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
}

function snapshotConfig(config) {
  if (!config || Object.getPrototypeOf(config) !== Object.prototype) throw new Error('INVALID_PROBE_CONFIG');
  const result = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(config))) {
    if (!('value' in descriptor)) throw new Error('INVALID_PROBE_CONFIG');
    const value = descriptor.value;
    if (key === 'route') {
      if (!Array.isArray(value) || value.length > 4) throw new Error('INVALID_ROUTE');
      result.route = Object.freeze(Array.from({ length: value.length }, (_, i) => {
        const entry = Object.getOwnPropertyDescriptor(value, i);
        if (!entry || !('value' in entry) || typeof entry.value !== 'string') throw new Error('INVALID_ROUTE');
        return entry.value;
      }));
    } else {
      if (value !== undefined && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('INVALID_PROBE_CONFIG');
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

// 只读采集不作商品语义判定。截图是视觉证据，XML可能含隐藏/失真文本，必须另行复核。
export async function probeReadOnly(config, dependencies = {}) {
  config = snapshotConfig(config);
  if (!idPattern.test(config.runId || '') || !config.taskId || !config.evidenceRoot || !packagePattern.test(config.expectedPackage || '')) throw new Error('INVALID_PROBE_CONFIG');
  readOnlyInvocation(config, 'online');
  const directory = join(resolve(config.evidenceRoot), `${config.runId}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const manifestPath = join(directory, 'manifest.json');
  const owner = `manual-${config.runId}-${randomUUID()}`;
  let remotePath = `/sdcard/agent-probe-${randomUUID()}.xml`;
  const brain = dependencies.brain || createBrainClient(config.brainBaseUrl);
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = config.commandTimeoutMs ?? 300000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('INVALID_COMMAND_TIMEOUT');
  const trace = [], files = [];
  let acquired = false, online = false, callIdle = false, lockReleased = false, failure = null;
  let screenshot, tree, foregroundBefore, foregroundAfter;
  function save(name, bytes) {
    const path = join(directory, name); writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    files.push({ name, path, sha256: digest(bytes), size: bytes.length }); return path;
  }
  async function run(operation) {
    if (await brain.owner(config.serial) !== owner) throw new Error('LOCK_OWNERSHIP_LOST');
    const invocation = readOnlyInvocation(config, operation, remotePath);
    const item = { operation, ...invocation, startedAt: new Date().toISOString(), ...(['dump', 'xml'].includes(operation) ? { remotePath } : {}) }; trace.push(item);
    const result = dependencies.run ? await dependencies.run(operation, invocation)
      : spawnSync(invocation.command, invocation.args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL', shell: false });
    item.finishedAt = new Date().toISOString(); item.exitCode = result.status; item.signal = result.signal || null;
    if (result.error || result.status !== 0) throw new Error(`COMMAND_FAILED:${operation}:${result.error?.code || result.status}`);
    return Buffer.from(result.stdout || '');
  }
  async function requireForeground() {
    const foreground = foregroundOf(await run('foreground'));
    if (foreground !== config.expectedPackage) throw new Error(`WRONG_FOREGROUND:${foreground}`);
    return foreground;
  }
  try {
    const lock = await brain.acquire(config.serial, owner);
    if (lock.acquired !== true) throw new Error('DEVICE_BUSY');
    acquired = true;
    if ((await run('online')).toString('utf8').trim() !== 'device') throw new Error('DEVICE_OFFLINE');
    online = true;
    const states = [...(await run('telephony')).toString('utf8').matchAll(/\bmCallState\s*=\s*(\d+)/g)];
    if (!states.length) throw new Error('CALL_STATE_UNCONFIRMED');
    if (states.some(match => match[1] !== '0')) throw new Error('CALL_ACTIVE');
    callIdle = true;
    foregroundBefore = await requireForeground();
    const png = await run('screenshot');
    if (!validScreenshot(png)) throw new Error('INVALID_SCREENSHOT');
    screenshot = save('screen.png', png);
    await requireForeground();
    let dumpError;
    for (let attempt = 0; attempt < 2; attempt++) {
      remotePath = `/sdcard/agent-probe-${randomUUID()}.xml`;
      try { await run('dump'); dumpError = null; break; }
      catch (error) { dumpError = error; if (error.message === 'LOCK_OWNERSHIP_LOST') throw error; if (!attempt) { await sleep(1500); await requireForeground(); } }
    }
    if (dumpError) throw dumpError;
    await requireForeground();
    const bytes = await run('xml');
    if (!/<hierarchy\b[\s\S]*<node\b[\s\S]*<\/hierarchy>/.test(bytes.toString('utf8'))) throw new Error('UI_TREE_UNAVAILABLE');
    tree = save('tree.xml', bytes);
    foregroundAfter = await requireForeground();
  } catch (error) {
    failure = error;
    // 获取锁的HTTP回执也可能丢失：先确认服务端归属，才能释放本次真正取得的锁。
    if (!acquired) {
      try { acquired = await brain.owner(config.serial) === owner; }
      catch (ownershipError) { trace.push({ acquireOwnershipUnconfirmed: ownershipError.message }); }
    }
    // 错前台截图只留本地诊断，不作商品证据或上传；来电/离线/无锁时不继续读取UI。
    if (acquired && online && callIdle && !screenshot) {
      try { const bytes = await run('screenshot'); if (validScreenshot(bytes)) save('diagnostic-screen.png', bytes); }
      catch (diagnosticError) { trace.push({ diagnosticFailure: diagnosticError.message }); }
    }
  } finally {
    if (acquired) {
      try {
        if (await brain.owner(config.serial) !== owner) throw new Error('LOCK_OWNERSHIP_LOST');
        const released = await brain.release(config.serial, owner);
        lockReleased = released.success === true && await brain.owner(config.serial) === null;
        if (!lockReleased) throw new Error('LOCK_RELEASE_UNCONFIRMED');
      } catch (error) { trace.push({ cleanupFailure: error.message }); failure ||= error; }
    }
    const manifest = { runId: config.runId, taskId: config.taskId, serial: config.serial, route: config.route, expectedPackage: config.expectedPackage,
      owner, status: failure ? 'blocked' : 'observed', failure: failure?.message || null, requiresVisualReview: true, foregroundBefore, foregroundAfter,
      lockReleased, trace, files, sideEffects: trace.filter(item => item.operation === 'dump').map(item => ({ action: 'UI hierarchy evidence artifact', remotePath: item.remotePath })),
      externalModelInteractions: 0 };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (failure) { failure.manifest = manifestPath; throw failure; }
  return { status: 'observed', requiresVisualReview: true, manifest: manifestPath, screenshot, tree, lockReleased };
}
