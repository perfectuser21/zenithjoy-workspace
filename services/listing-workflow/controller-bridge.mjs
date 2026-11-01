import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBrainClient, readOnlyInvocation } from './phone-probe.mjs';
import { materialPolicy as authorizeMaterials } from './authorized-media.mjs';

const quote = x => `'${String(x).replaceAll("'", "'\\''")}'`;
const commands = new Set(['preflight', 'foreground', 'snapshot-evidence', 'ui-evidence']);
export function createControllerBridge(config, dependencies = {}) {
  const clonedBinding = structuredClone(config.binding);
  Object.freeze(clonedBinding.route); const binding = Object.freeze(clonedBinding);
  readOnlyInvocation({ serial: binding.serial, route: binding.route }, 'online');
  if (!/^[a-f0-9]{64}$/.test(binding.controllerSha256 || '') || !/^[a-f0-9]{64}$/.test(binding.focusSha256 || '') ||
      !/^\/Users\/[A-Za-z0-9_-]+\/(?:bin-harvest|\.local\/bin)\/douyin-phone-adb$/.test(binding.controllerPath || '') ||
      !/^[a-zA-Z0-9_-]+$/.test(binding.baseProfile || '') || !binding.authority) throw new Error('INVALID_CONTROLLER_BINDING');
  const materialPolicy = config.materials ? authorizeMaterials(config) : null;
  const id = randomUUID(), directory = resolve(config.root);
  let state = { processPid: process.pid, binding, materialPolicy, id, runId: config.runId, owner: `manual-pdd-native-${id.replaceAll('-', '')}`, profile: `pdd${id.replaceAll('-', '')}`, remoteRoot: `/private/tmp/pdd-native-${id}`,
    brainHeld: false, controllerHeld: false, remoteUnknown: false, lockReleased: false, trace: [] };
  const brain = dependencies.brain || createBrainClient(binding.brainBaseUrl);
  const timeoutMs = config.commandTimeoutMs ?? 300000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000 || !config.runId) throw new Error('INVALID_COMMAND_BUDGET');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statePath = join(directory, 'controller-session.json');
  if (existsSync(statePath)) throw new Error('EXISTING_SESSION_REQUIRES_RECOVERY');
  function persist() {
    const temporary = statePath + '.pending-' + randomUUID();
    const fd = openSync(temporary, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify(state, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, statePath); const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  persist();
  const helperSource = dependencies.remote ? '' : readFileSync(new URL('./controller-host.py', import.meta.url), 'utf8');
  const uiSource = dependencies.remote ? '' : readFileSync(new URL('./pdd-native-ui.py', import.meta.url));
  const pixelsSource = dependencies.remote ? '' : readFileSync(new URL('./pdd-native-pixels.py', import.meta.url));
  const albumSource = dependencies.remote ? '' : readFileSync(new URL('./owned-album.py', import.meta.url));
  const mediaCleanupSource = dependencies.remote ? '' : readFileSync(new URL('./owned-media-cleanup.py', import.meta.url));
  const pickerSource = dependencies.remote ? '' : readFileSync(new URL('./pdd-media-picker.py', import.meta.url));
  const gallerySource = dependencies.remote ? '' : readFileSync(new URL('./pdd-gallery-actions.py', import.meta.url));
  const pickerActionsSource = dependencies.remote ? '' : readFileSync(new URL('./pdd-media-actions.py', import.meta.url));
  const nativeSource = dependencies.remote ? '' : readFileSync(new URL('./pdd-native-host.py', import.meta.url));
  const script = `import base64,json,sys
_ui={'__name__':'pdd_native_ui'}
exec(base64.b64decode('${uiSource ? uiSource.toString('base64') : ''}'),_ui)
_pixels={'__name__':'pdd_pixels'}
exec(base64.b64decode('${pixelsSource ? pixelsSource.toString('base64') : ''}'),_pixels)
_host={'__name__':'pdd_host_bundle','Screen':_ui['Screen'],'png_crop_sha':_pixels['png_crop_sha']}
exec(base64.b64decode('${Buffer.from(helperSource).toString('base64')}'),_host)
exec(base64.b64decode('${albumSource ? albumSource.toString('base64') : ''}'),_host)
exec(base64.b64decode('${mediaCleanupSource ? mediaCleanupSource.toString('base64') : ''}'),_host)
exec(base64.b64decode('${pickerSource ? pickerSource.toString('base64') : ''}'),_host)
exec(base64.b64decode('${pickerActionsSource ? pickerActionsSource.toString('base64') : ''}'),_host)
exec(base64.b64decode('${gallerySource ? gallerySource.toString('base64') : ''}'),_host)
exec(base64.b64decode('${nativeSource ? nativeSource.toString('base64') : ''}'),_host)
try: print(json.dumps(_host['dispatch'](json.load(sys.stdin)),ensure_ascii=False))
except Exception as e: print(json.dumps({'error':str(e),'remoteUnknown':getattr(e,'remoteUnknown',False)}))
`;
  state.gallerySha256 = createHash('sha256').update(gallerySource).digest('hex');
  state.pickerSha256 = createHash('sha256').update(pickerSource).digest('hex'); state.pickerActionsSha256 = createHash('sha256').update(pickerActionsSource).digest('hex');
  state.albumSha256 = createHash('sha256').update(albumSource).digest('hex'); state.mediaCleanupSha256 = createHash('sha256').update(mediaCleanupSource).digest('hex');
  state.pixelsSha256 = createHash('sha256').update(pixelsSource).digest('hex');
  state.nativeSha256 = createHash('sha256').update(nativeSource).digest('hex'); state.helperSha256 = createHash('sha256').update(helperSource).digest('hex'); state.uiSha256 = createHash('sha256').update(uiSource).digest('hex'); persist();
  const remote = dependencies.remote || (async request => {
    let tokens = ['python3', '-c', script];
    for (let i = binding.route.length - 1; i > 0; i--) tokens = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '--', binding.route[i], tokens.map(quote).join(' ')];
    const invocation = binding.route.length ? { command: 'ssh', args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '--', binding.route[0], tokens.map(quote).join(' ')] } : { command: tokens[0], args: tokens.slice(1) };
    const reply = spawnSync(invocation.command, invocation.args, { input: JSON.stringify(request), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, shell: false });
    if (reply.error || reply.signal || reply.status === 255) throw Object.assign(new Error(`SSH_UNKNOWN:${reply.error?.code || reply.signal || reply.status}`), { remoteUnknown: true });
    if (reply.status !== 0) throw new Error(`REMOTE_HELPER_FAILED:${reply.stderr.slice(0, 2000)}`);
    let result; try { result = JSON.parse(reply.stdout); } catch { throw Object.assign(new Error('REMOTE_REPLY_UNPARSABLE'), { remoteUnknown: true }); }
    if (result.error) throw Object.assign(new Error(result.error), { remoteUnknown: result.remoteUnknown === true });
    return result;
  });
  async function send(action, extra = {}) {
    if (Object.keys(extra).some(key => ['action','binding','owner','profile','remoteRoot','jobId','operationBudgetMs','materialPolicy'].includes(key))) throw new Error('RESERVED_REQUEST_FIELD');
    const request = { action, binding, materialPolicy, owner: state.owner, profile: state.profile, remoteRoot: state.remoteRoot, operationBudgetMs: timeoutMs - 15000, ...extra };
    const item = { action, command: extra.command, at: new Date().toISOString(), jobId: randomUUID() }; state.trace.push(item); persist();
    try { const result = await remote({ ...request, jobId: item.jobId }); item.finishedAt = new Date().toISOString(); persist(); return result; }
    catch (error) { item.error = error.message; if (error.remoteUnknown) state.remoteUnknown = true; persist(); throw error; }
  }
  async function lease() {
    if (state.remoteUnknown) throw new Error('REMOTE_TERMINATION_UNCONFIRMED');
    const current = await brain.lease(binding.serial);
    if (current.locked_by !== state.owner) throw new Error('BRAIN_LOCK_OWNERSHIP_LOST');
    const remaining = Date.parse(current.expires_at) - current.serverTimeMs - current.networkElapsedMs - 1000;
    if (current.expired !== false || !Number.isFinite(remaining) || remaining < timeoutMs + 10000) throw new Error('LEASE_UNSAFE');
    state.brainLeaseRemainingMs = remaining; persist();
  }
  async function controllerStatus() {
    const result = await send('controller', { command: 'lock-status', args: [] });
    const match = /^lock=held owner=(\S+) age=(\d+)s stale=false reclaimable=false ttl=(\d+)s\s*$/.exec(result.stdout.trim());
    if (!match || match[1] !== state.owner) throw new Error('CONTROLLER_LOCK_OWNERSHIP_LOST');
    if ((Number(match[3]) - Number(match[2])) * 1000 < Math.max(timeoutMs + 10000, 1010000)) throw new Error('CONTROLLER_LEASE_UNSAFE');
    return result;
  }
  const api = {
    get state() { return structuredClone(state); }, statePath, binding,
    async begin() {
      try {
        const acquired = await brain.acquire(binding.serial, state.owner);
        if (acquired.acquired !== true) throw new Error('DEVICE_BUSY');
        state.brainHeld = true; persist(); await lease();
        const actual = await send('inspect');
        const expected = { serial: binding.serial, model: binding.model, width: binding.width, height: binding.height, enabled: true };
        if (actual.controllerSha256 !== binding.controllerSha256 || actual.focusSha256 !== binding.focusSha256 || JSON.stringify(actual.profile) !== JSON.stringify(expected)) throw new Error('CONTROLLER_BINDING_MISMATCH');
        await send('initialize');
        state.controllerAcquireAttempted = true; persist();
        const lock = await send('controller', { command: 'lock-acquire-new', args: [state.owner] });
        if (!lock.stdout.includes(`lock=acquired owner=${state.owner}`)) throw new Error('CONTROLLER_ACQUIRE_UNCONFIRMED');
        state.controllerHeld = true; persist(); await controllerStatus(); return structuredClone(state);
      } catch (error) {
        if (!state.brainHeld) { try { state.brainHeld = (await brain.lease(binding.serial)).locked_by === state.owner; } catch { state.brainOwnershipUnconfirmed = true; } persist(); }
        if (state.controllerAcquireAttempted && !state.controllerHeld && !state.remoteUnknown) {
          try { const status = await send('controller', { command: 'lock-status', args: [] }); state.controllerHeld = status.stdout.includes('owner=' + state.owner + ' '); state.controllerOwnershipUnconfirmed = !state.controllerHeld && status.stdout.trim() !== 'lock=free'; } catch { state.remoteUnknown = true; } persist();
        }
        if (!state.remoteUnknown && state.brainHeld && !state.controllerHeld && !state.controllerOwnershipUnconfirmed) { await brain.release(binding.serial, state.owner); state.brainHeld = false; persist(); }
        throw error;
      }
    },
    async command(command, args = []) {
      if (!commands.has(command) || !Array.isArray(args) || args.some(x => typeof x !== 'string')) throw new Error('FORBIDDEN_CONTROLLER_COMMAND');
      if (!state.brainHeld || !state.controllerHeld) throw new Error('DUAL_LOCK_REQUIRED');
      await lease(); await controllerStatus();
      await send('controller', { command: 'lock-refresh', args: [state.owner] });
      await lease();
      const result = await send('controller', { command, args });
      if (/accepted fresh|\b137\b|ERROR:/.test(result.stderr || '')) throw new Error('UI_PRODUCER_UNTRUSTED');
      return result;
    },
    async host(action, data = {}) {
      if (!['stage-media', 'read-evidence', 'phone-readback', 'phone-cleanup', 'observe', 'navigate', 'approve-draft', 'set-field', 'push-owned-media', 'organize-media', 'picker-more', 'picker-permission', 'picker-select', 'picker-confirm', 'gallery-state', 'gallery-menu', 'gallery-album', 'gallery-select', 'gallery-upload', 'gallery-back', 'discard-draft', 'back', 'launch'].includes(action)) throw new Error('FORBIDDEN_HOST_OPERATION');
      await lease(); await controllerStatus(); await send('controller', { command: 'lock-refresh', args: [state.owner] }); await lease(); return send(action, data);
    },
    async finish() {
      await lease(); await controllerStatus();
      await send('phone-cleanup');
      await send('controller', { command: 'lock-release-exact', args: [state.owner] });
      const status = await send('controller', { command: 'lock-status', args: [] });
      if (status.stdout.trim() !== 'lock=free') throw new Error('CONTROLLER_RELEASE_UNCONFIRMED');
      state.controllerHeld = false; persist();
      const released = await brain.release(binding.serial, state.owner);
      if (released.success !== true || (await brain.lease(binding.serial)).locked_by !== null) throw new Error('BRAIN_RELEASE_UNCONFIRMED');
      state.brainHeld = false; state.lockReleased = true; persist(); return structuredClone(state);
    },
  };
  let busy = false;
  for (const name of ['begin','command','host','finish']) {
    const action = api[name];
    api[name] = async (...args) => {
      if (busy) throw new Error('SESSION_OPERATION_BUSY');
      busy = true;
      try { return await action(...args); } finally { busy = false; }
    };
  }
  return api;
}
