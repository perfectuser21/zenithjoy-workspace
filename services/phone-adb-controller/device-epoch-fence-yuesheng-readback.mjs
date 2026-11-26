import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytes, canonical, digest } from './device-epoch-fence-reference.mjs';

const physicalSerial = 'B114E2190975';
const transportSerial = '127.0.0.1:15555';
const oldEndpoint = 'tcp:127.0.0.1:5044';
const newEndpoint = 'tcp:127.0.0.1:5045';
const instanceId = 'mmv-yuesheng-direct';
const registryPath = 'config/adb-host-instances.json';
const repository = 'perfectuser21/zenithjoy-workspace';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const maxObservationAgeMs = 120_000;

export const yueshengMigrationRoute = Object.freeze({ physical_serial: physicalSerial, transport_serial: transportSerial,
  old_endpoint: oldEndpoint, new_endpoint: newEndpoint, new_instance_id: instanceId });

function need(value, code) {
  if (value) return;
  const errorCode = `YUESHENG_MIGRATION_${code}`;
  throw Object.assign(Error(errorCode), { code: errorCode });
}

function checkCandidate(candidate) {
  const { manifest, gate } = candidate ?? {};
  const commit = manifest?.source_commit;
  need(/^[a-f0-9]{40}$/.test(commit ?? '') && manifest.source_repo === repository
    && manifest.target === 'mmv' && manifest.environment === `staging:${commit}`
    && uuid.test(manifest.release_id ?? '') && uuid.test(manifest.observation_id ?? ''), 'CANDIDATE');
  need(gate?.release_id === manifest.release_id && gate.current_observation_id === manifest.observation_id
    && gate.deployed === true && gate.actual_matches === true && Array.isArray(gate.gaps) && gate.gaps.length === 0, 'CANDIDATE_GATE');

  const pinnedFiles = [registryPath, 'adb-host-instance-policy.py', 'adb-host-service.py', 'device-epoch-fence-review.mjs'];
  for (const name of pinnedFiles) {
    const files = Array.isArray(manifest.files) && manifest.files.filter(row => row.deployed_path === name);
    const raw = bytes(fileURLToPath(new URL(name, import.meta.url)));
    need(files?.length === 1 && files[0].path === `services/phone-adb-controller/${name}`
      && files[0].content_sha256 === digest(raw), name === registryPath ? 'CANDIDATE_REGISTRY' : 'CANDIDATE_STARTUP_SOURCE');
  }
  const registry = JSON.parse(bytes(fileURLToPath(new URL(registryPath, import.meta.url))));
  const rows = registry.instances.filter(row => row.instance_id === instanceId);
  need(registry.schema_version === 1 && rows.length === 1 && rows[0].kind === 'managed'
    && rows[0].policy.schema_version === 2 && rows[0].policy.instance_id === instanceId
    && rows[0].policy.host_id === 'mmv' && rows[0].policy.transport === 'tcp'
    && rows[0].policy.endpoint === newEndpoint, 'REGISTERED_INSTANCE');
  return commit;
}

function checkInventory(route, endpoint, present, code) {
  need(route?.host_id === 'mmv' && route.endpoint === endpoint && route.port === Number(endpoint.split(':').at(-1))
    && Array.isArray(route.devices) && route.devices.length === Number(present), code);
  if (present) need(route.devices[0]?.serial === transportSerial && route.devices[0].state === 'device', code);
}

function checkIdentity(readback, endpoint, observedAt, code) {
  const serial = readback?.['ro.serialno'];
  need(readback?.endpoint === endpoint && readback.transport_serial === transportSerial && readback.observed_at === observedAt
    && serial?.exit === 0 && serial.value === physicalSerial && serial.diagnostic === '', code);
}

function checkLease(lease, task) {
  need(lease?.device_name === physicalSerial && lease.locked_by === task.id && lease.expired === false
    && /^[1-9][0-9]{0,9}$/.test(lease.lease_version ?? '') && typeof lease.lease_version === 'string'
    && Number(lease.lease_version) <= 4_294_967_295, 'LEASE');
  return [lease.locked_at, lease.expires_at, lease.lease_version];
}

export function verifyYueshengBefore({ candidate, before }, now = Date.now()) {
  const commit = checkCandidate(candidate);
  const observedAt = Date.parse(before?.observed_at);
  need(observedAt <= now && now - observedAt <= maxObservationAgeMs, 'OBSERVATION_WINDOW');
  checkInventory(before.old_route, oldEndpoint, true, 'OLD_ROUTE_BEFORE');
  checkInventory(before.new_route, newEndpoint, false, 'NEW_ROUTE_BEFORE');
  checkIdentity(before.physical_readback, oldEndpoint, before.observed_at, 'OLD_IDENTITY');
  return commit;
}

export function verifyYueshengBetween(observation) {
  checkInventory(observation?.old_route, oldEndpoint, false, 'OLD_ROUTE_AFTER');
  checkInventory(observation?.new_route, newEndpoint, false, 'NEW_ROUTE_BEFORE');
}

// Checks recorded observations only. The output cannot authorize actions or satisfy epoch admission.
export function verifyYueshengMigrationReadback({ task, candidate, before, after, current_lock: currentLock }, now = Date.now()) {
  const sourceCommit = verifyYueshengBefore({ candidate, before }, now);
  const claimedAt = Date.parse(task?.claimed_at);
  need(uuid.test(task?.id ?? '') && task.status === 'in_progress' && typeof task.claimed_by === 'string'
    && task.claimed_by.trim().length > 0 && Number.isFinite(claimedAt), 'TASK');
  const currentLease = checkLease(currentLock, task);
  need(canonical(checkLease(before?.lock, task)) === canonical(currentLease)
    && canonical(checkLease(after?.lock, task)) === canonical(currentLease), 'LEASE_CHANGED');
  const [lockedTime, expiryTime] = currentLease;
  const lockedAt = Date.parse(lockedTime), expiresAt = Date.parse(expiryTime);
  const beforeAt = Date.parse(before?.observed_at), afterAt = Date.parse(after?.observed_at);
  need(Number.isFinite(now) && claimedAt <= lockedAt && lockedAt <= beforeAt && beforeAt < afterAt && afterAt <= now
    && expiresAt > now && now - beforeAt <= maxObservationAgeMs, 'OBSERVATION_WINDOW');

  checkInventory(after.old_route, oldEndpoint, false, 'OLD_ROUTE_AFTER');
  checkInventory(after.new_route, newEndpoint, true, 'NEW_ROUTE_AFTER');
  checkIdentity(after.physical_readback, newEndpoint, after.observed_at, 'NEW_IDENTITY');

  return { protocol: 'yuesheng-adb-migration-observation/v1', authorization: 'none', task_id: task.id,
    lease_version: currentLock.lease_version, source_commit: sourceCommit, release_id: candidate.manifest.release_id,
    observation_id: candidate.manifest.observation_id, physical_serial: physicalSerial, transport_serial: transportSerial,
    old_endpoint: oldEndpoint, new_endpoint: newEndpoint, before_at: before.observed_at, after_at: after.observed_at,
    readback_sha256: digest({ task, candidate, before, after, current_lock: currentLock }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3, 'USAGE');
    const observation = JSON.parse(bytes(resolve(process.argv[2])));
    process.stdout.write(JSON.stringify(verifyYueshengMigrationReadback(observation)) + '\n');
  } catch (error) {
    process.stderr.write((/^YUESHENG_MIGRATION_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'YUESHENG_MIGRATION_INPUT') + '\n');
    process.exitCode = 1;
  }
}
