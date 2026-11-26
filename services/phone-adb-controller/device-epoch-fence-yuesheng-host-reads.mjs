import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDiagnosticProof, runDiagnostic } from './device-epoch-fence-diagnostics.mjs';
import { privateDirectory } from './device-epoch-fence-files.mjs';
import { canonical, readPrivatePolicy } from './device-epoch-fence-reference.mjs';
import { hostOperation, parseDeviceInventory } from './device-epoch-fence-transport.mjs';
import { yueshengMigrationRoute as route } from './device-epoch-fence-yuesheng-readback.mjs';
import { maintenanceBrainRequest } from './qualification-maintenance-brain.mjs';

export const yueshengMaintenanceTask = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commit = /^[a-f0-9]{40}$/;
const leaseKeys = ['device_name', 'locked_by', 'locked_at', 'expires_at', 'lease_version', 'expired'];

function need(value, condition) {
  if (value) return;
  const code = 'YUESHENG_MIGRATION_' + condition;
  throw Object.assign(Error(code), { code });
}

export async function readYueshengMigrationAuthority({ taskId, pendingActionId }, { readBrain = maintenanceBrainRequest } = {}) {
  need(taskId === yueshengMaintenanceTask && uuid.test(pendingActionId ?? ''), 'AUTHORITY_INPUT');
  const [taskReply, actionReply, deviceLocks] = await Promise.all([
    readBrain('/tasks/' + taskId), readBrain('/pending-actions/' + pendingActionId), readBrain('/device-locks'),
  ]);
  return { task: taskReply?.task ?? taskReply, pendingAction: actionReply?.action ?? actionReply, deviceLocks };
}

function readCandidateManifest(sourceCommit) {
  const location = join(homedir(), '.local/share/zenithjoy/phone-candidates', sourceCommit, 'runtime/deployment-manifest.json');
  return JSON.parse(readPrivatePolicy(location));
}

export async function readYueshengInstalledCandidate(sourceCommit, {
  readBrain = maintenanceBrainRequest, readManifest = readCandidateManifest,
} = {}) {
  need(commit.test(sourceCommit ?? ''), 'CANDIDATE');
  const manifest = await readManifest(sourceCommit);
  need(manifest?.source_commit === sourceCommit && uuid.test(manifest.release_id ?? ''), 'CANDIDATE');
  const gate = await readBrain('/releases/' + manifest.release_id + '/gate');
  return { manifest, gate };
}

const bindingHelper = fileURLToPath(new URL('./yuesheng-adb-daemon-binding.py', import.meta.url));

async function readDaemonBinding(sourceCommit, routeName, expected = null) {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/python3', ['-I', '-B', '-S', bindingHelper], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, timeout: 15_000, maxBuffer: 65_536,
    }, (error, stdout) => {
      try {
        need(!error, 'DAEMON_IDENTITY');
        const value = JSON.parse(stdout);
        const endpoint = routeName === 'old' ? route.old_endpoint : route.new_endpoint;
        need(value?.endpoint === endpoint && value.kind === (routeName === 'old' ? 'external_existing' : 'managed')
          && Number.isSafeInteger(value.child?.pid), 'DAEMON_IDENTITY');
        resolve(value);
      } catch { reject(Object.assign(Error('YUESHENG_MIGRATION_DAEMON_IDENTITY'), { code: 'YUESHENG_MIGRATION_DAEMON_IDENTITY' })); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(canonical({ source_commit: sourceCommit, route: routeName, expected }));
  });
}

export async function createYueshengDaemonBinding({ sourceCommit }) {
  need(commit.test(sourceCommit ?? ''), 'DAEMON_SCOPE');
  const [old, next] = await Promise.all([readDaemonBinding(sourceCommit, 'old'), readDaemonBinding(sourceCommit, 'next')]);
  const expected = { old, next };
  return { daemons: structuredClone(expected), async bindDaemon(daemon) {
    const name = daemon?.endpoint === route.old_endpoint ? 'old' : 'next';
    need(canonical(daemon) === canonical(expected[name]), 'DAEMON_SCOPE');
    const actual = await readDaemonBinding(sourceCommit, name, expected[name]);
    need(canonical(actual) === canonical(expected[name]), 'DAEMON_IDENTITY');
    return actual;
  } };
}

// bindDaemon must re-verify each pre-bound listener against its trusted process identity.
export async function readYueshengHostObservation({ phase, journalRoot, daemons, expectedLease }, {
  bindDaemon, readBrain = maintenanceBrainRequest, now = Date.now,
} = {}) {
  const { old, next } = structuredClone(daemons ?? {});
  need(['before', 'between', 'after'].includes(phase) && expectedLease, 'HOST_OBSERVATION_INPUT');
  need(old?.endpoint === route.old_endpoint && next?.endpoint === route.new_endpoint
    && typeof bindDaemon === 'function', 'DAEMON_SCOPE');
  const root = privateDirectory(journalRoot);
  const leaseSignature = canonical(leaseKeys.map(key => expectedLease[key]));
  async function authority(daemon, scope, authorizedAction) {
    const reply = await readBrain('/device-locks');
    const matches = reply?.success === true && Array.isArray(reply.locks)
      && reply.locks.filter(row => row.device_name === route.physical_serial);
    const lease = matches?.[0], observed = now(), lockedAt = Date.parse(lease?.locked_at);
    need(matches?.length === 1 && lease.locked_by === yueshengMaintenanceTask && lease.device_name === route.physical_serial
      && lease.expired === false && typeof lease.lease_version === 'string' && /^[1-9][0-9]{0,9}$/.test(lease.lease_version)
      && Number(lease.lease_version) <= 4_294_967_295 && lockedAt <= observed
      && Date.parse(lease.expires_at) > observed + 5_000, 'HOST_LEASE');
    need(canonical(leaseKeys.map(key => lease[key])) === leaseSignature, 'HOST_LEASE');
    need(await bindDaemon(daemon) !== false, 'DAEMON_SCOPE');
    return { scope, authorized_action: authorizedAction, lease_until: lease.expires_at };
  }
  async function list(daemon, expectedPresent) {
    const scope = { endpoint: daemon.endpoint, serial: route.transport_serial };
    const readAuthority = () => authority(daemon, scope, 'inventory');
    await readAuthority();
    const receipt = await hostOperation({ operation: 'inventory', scope, readAuthority,
      directory: mkdtempSync(join(root, phase + '-inventory-')) });
    need(receipt?.wire_complete === true && receipt.action_confirmed === true && receipt.peer_eof === true
      && receipt.socket_closed === true && receipt.pending === 0 && receipt.error_code === null
      && canonical(receipt.scope) === canonical(scope), 'HOST_INVENTORY');
    const devices = parseDeviceInventory(receipt.response);
    need(devices.length === Number(expectedPresent) && (!expectedPresent ||
      (devices[0].serial === route.transport_serial && devices[0].state === 'device')), 'HOST_INVENTORY');
    return { host_id: 'mmv', endpoint: daemon.endpoint, port: Number(daemon.endpoint.split(':').at(-1)), devices };
  }
  const inventories = () => Promise.all([list(old, phase === 'before'), list(next, phase === 'after')]);
  const initial = await inventories();
  const active = phase === 'before' ? old : phase === 'after' ? next : null;
  let physicalReadback;
  if (active) {
    const scope = { endpoint: active.endpoint, serial: route.transport_serial, maintenance_task_id: yueshengMaintenanceTask };
    const receipt = await runDiagnostic({ query: 'yuesheng_physical_serial', scope, directory: mkdtempSync(join(root, phase + '-serial-')),
      readAuthority: () => authority(active, scope, 'yuesheng_physical_serial') });
    need(receipt?.wire_complete === true && receipt.exit_code === 0, 'HOST_IDENTITY');
    const proof = readDiagnosticProof(receipt);
    const wanted = Buffer.from(route.physical_serial + '\n');
    need(proof.query === 'yuesheng_physical_serial' && canonical(proof.scope) === canonical(scope)
      && proof.stderr.length === 0 && (proof.stdout.equals(wanted) || proof.stdout.equals(Buffer.from(route.physical_serial + '\r\n'))), 'HOST_IDENTITY');
    physicalReadback = { endpoint: active.endpoint, transport_serial: route.transport_serial,
      'ro.serialno': { exit: 0, value: route.physical_serial, diagnostic: '' } };
  }
  const confirmed = active ? await inventories() : initial;
  need(canonical(confirmed) === canonical(initial), 'HOST_INVENTORY');
  await Promise.all([authority(old), authority(next)]);
  const [oldRoute, newRoute] = confirmed;
  const observedAt = new Date(now()).toISOString();
  return { observed_at: observedAt, old_route: oldRoute, new_route: newRoute,
    ...(physicalReadback ? { physical_readback: { ...physicalReadback, observed_at: observedAt } } : {}) };
}
