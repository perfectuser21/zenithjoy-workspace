import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest, readPrivatePolicy } from './device-epoch-fence-reference.mjs';
import { verifyYueshengBefore, yueshengMigrationRoute } from './device-epoch-fence-yuesheng-readback.mjs';
import { maintenanceBrainRequest } from './qualification-maintenance-brain.mjs';

const maintenanceTask = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commit = /^[a-f0-9]{40}$/;
const leaseKeys = ['device_name', 'locked_by', 'locked_at', 'expires_at', 'lease_version', 'expired'];

function need(value, condition) {
  if (!value) {
    const code = `YUESHENG_MIGRATION_${condition}`;
    throw Object.assign(Error(code), { code });
  }
}

function readCandidateManifest(sourceCommit) {
  const location = join(homedir(), '.local/share/zenithjoy/phone-candidates', sourceCommit, 'runtime/deployment-manifest.json');
  return JSON.parse(readPrivatePolicy(location));
}

async function readAuthority({ taskId, pendingActionId, sourceCommit, read, now }) {
  const [taskReply, actionReply, deviceLocks] = await Promise.all([
    read('/tasks/' + taskId), read('/pending-actions/' + pendingActionId), read('/device-locks'),
  ]);
  const task = taskReply?.task ?? taskReply;
  const action = actionReply?.action ?? actionReply;
  const claimedAt = Date.parse(task?.claimed_at);
  const observedAt = now();
  need(task?.id === taskId && task.status === 'in_progress' && task.payload?.work_kind === 'coding_review'
    && Array.isArray(task.payload.scope) && task.payload.scope.includes('enable_mmv_yuesheng_5045')
    && typeof task.claimed_by === 'string' && task.claimed_by.trim().length > 0 && claimedAt <= observedAt, 'TASK');
  const matches = deviceLocks?.success === true && Array.isArray(deviceLocks.locks)
    && deviceLocks.locks.filter(row => row.device_name === yueshengMigrationRoute.physical_serial);
  const lease = matches?.[0];
  const lockedAt = Date.parse(lease?.locked_at);
  need(matches?.length === 1 && lease.locked_by === taskId && lease.expired === false
    && typeof lease.lease_version === 'string' && /^[1-9][0-9]{0,9}$/.test(lease.lease_version)
    && Number(lease.lease_version) <= 4_294_967_295 && claimedAt <= lockedAt && lockedAt <= observedAt
    && Date.parse(lease.expires_at) > observedAt + 5_000, 'LEASE');
  need(action?.id === pendingActionId && action.status === 'pending_approval'
    && action.action_type === 'owner_decision' && action.source === 'yuesheng_adb_migration'
    && canonical(action.params ?? null) === canonical({ protocol: 'yuesheng-adb-migration-request/v1',
      task_id: taskId, device_name: lease.device_name, lease_version: lease.lease_version, source_commit: sourceCommit }), 'PENDING_ACTION');
  return { claim: { claimed_by: task.claimed_by, claimed_at: task.claimed_at },
    lease: Object.fromEntries(leaseKeys.map(key => [key, lease[key]])) };
}

export async function planYueshengMigration({ taskId, pendingActionId, sourceCommit }, {
  readBrain: read = maintenanceBrainRequest, readCandidateManifest: readManifest = readCandidateManifest, readBefore, now = Date.now,
} = {}) {
  need(taskId === maintenanceTask && uuid.test(pendingActionId ?? '') && commit.test(sourceCommit ?? '')
    && typeof readBefore === 'function', 'PLAN_INPUT');
  const authorityArgs = { taskId, pendingActionId, sourceCommit, read, now };
  const authority = await readAuthority(authorityArgs);
  const manifest = await readManifest(sourceCommit);
  need(manifest?.source_commit === sourceCommit && uuid.test(manifest.release_id ?? ''), 'CANDIDATE');
  const gatePath = '/releases/' + manifest.release_id + '/gate';
  const gate = await read(gatePath);
  const before = await readBefore();
  need(verifyYueshengBefore({ candidate: { manifest, gate }, before }, now()) === sourceCommit, 'CANDIDATE');
  need(Date.parse(before.observed_at) >= Date.parse(authority.lease.locked_at), 'OBSERVATION_WINDOW');
  const [confirmed, currentGate] = await Promise.all([readAuthority(authorityArgs), read(gatePath)]);
  need(canonical(confirmed) === canonical(authority), 'AUTHORITY_CHANGED');
  verifyYueshengBefore({ candidate: { manifest, gate: currentGate }, before }, now());
  const plan = { protocol: 'yuesheng-adb-migration-plan/v1', task_id: taskId, pending_action_id: pendingActionId,
    source_commit: sourceCommit, release_id: manifest.release_id, observation_id: manifest.observation_id,
    ...yueshengMigrationRoute, ...authority };
  return { plan, plan_sha256: digest(plan) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 6, 'USAGE');
    const [, , taskId, pendingActionId, sourceCommit, beforeFile] = process.argv;
    const result = await planYueshengMigration({ taskId, pendingActionId, sourceCommit },
      { readBefore: () => JSON.parse(readPrivatePolicy(resolve(beforeFile))) });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write((/^YUESHENG_MIGRATION_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'YUESHENG_MIGRATION_PLAN_READ') + '\n');
    process.exitCode = 1;
  }
}
