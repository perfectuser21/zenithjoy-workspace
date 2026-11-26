import { mkdirSync, mkdtempSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundAdbDaemon } from './device-epoch-fence-admission.mjs';
import { readReleaseProof, releaseCentralLease } from './device-epoch-fence-central.mjs';
import { createCloudHostReads } from './device-epoch-fence-cloud-host-reads.mjs';
import { withCloudDeviceGuard } from './device-epoch-fence-cloud-local-guard.mjs';
import { applyCloudFencePlan, cloudFenceRoute as route, createCloudFencePlan, requireCloudFence as need } from './device-epoch-fence-cloud-migration.mjs';
import { ensureRecordRoot, privateDirectory, save } from './device-epoch-fence-files.mjs';
import { bytes, canonical, digest, freezeFenceReference, readCloudExistingEpochCompletion, readPrivatePolicy, validateEpochRecord } from './device-epoch-fence-reference.mjs';
import { reviewSource } from './device-epoch-fence-review.mjs';
import { hostOperation } from './device-epoch-fence-transport.mjs';
import { maintenanceBrainRequest } from './qualification-maintenance-brain.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const same = (left, right) => canonical(left) === canonical(right);
const cloudSource = () => reviewSource({ includeCloudIssuer: true });
const read = path => maintenanceBrainRequest(path.slice('/api/brain'.length));
const post = async (path, body) => ({ status: 200, body: await maintenanceBrainRequest(path.slice('/api/brain'.length), body) });

export function createCloudEpochIssuer({
  daemons, host, instance, assertPostRelease, home = userInfo().homedir,
  source = cloudSource, centralRead = read, centralPost = post, ensureRecords = ensureRecordRoot,
}) {
  const base = join(home, '.local/share/zenithjoy');
  return async ({ journal, plan, result, completionSha, assertAuthority, assertHeld, assertCandidate }) => {
    const authority = await assertAuthority();
    await assertCandidate();
    const runtimeSource = source();
    const scope = { maintenance_task_id: plan.task_id, serial: route.serial, claim: plan.claim };
    const directory = join(base, 'device-epoch-fences', route.serial);
    const resourceScope = { ...host, policy: instance.policy, source_commit: plan.source_commit };
    need(journal === join(base, 'device-epoch-migrations', route.serial, 'cloud-test-5041-to-5042', plan.task_id)
      && runtimeSource.commit === plan.source_commit && result.plan_sha256 === digest(plan)
      && host.serial === route.serial && instance.instance_id === route.instance_id, 'ISSUE_SCOPE');
    need(same(readBoundRouteDigests(daemons), {
      old: JSON.parse(readPrivatePolicy(join(journal, 'before.json'))).old_daemon_sha256,
      next: JSON.parse(readPrivatePolicy(join(journal, 'after.json'))).new_daemon_sha256,
    }), 'ISSUE_ROUTES');
    ensureRecords(directory);
    save(join(journal, 'central-release-intent.json'), { plan_sha256: result.plan_sha256, scope, lease: authority.lease });
    const released = await releaseCentralLease({ scope, lease: authority.lease,
      read: centralRead, post: centralPost, readAuthority: assertAuthority });
    need(released.status === 'released', 'ISSUE_CAS_UNKNOWN');
    const proof = readReleaseProof(released.receipt);
    save(join(journal, 'central-release-result.json'), proof);
    await assertCandidate();
    await assertPostRelease({ proof, authority, assertHeld, journal });

    const record = {
      protocol: 'device-epoch-fence-record/v1', status: 'fenced', authority_basis: 'approved-existing-cloud-route-fence/v1',
      original_execution_stopped: false, android_internal: 'not_attested', epoch_id: plan.task_id,
      resource: plan.resource, old_route: daemons.old, new_route: daemons.next, runtime_source: runtimeSource,
      original: plan.original,
      cloud_migration: { journal_path: journal, plan_sha256: result.plan_sha256, approval_sha256: authority.approval_sha256,
        completion_sha256: completionSha, wire_sha256: result.wire_sha256, central_release: proof,
        release_id: plan.release_id, observation_id: plan.observation_id,
        hardware_serial_sha256: result.hardware_serial_sha256, boot_id_sha256: result.boot_id_sha256 },
      created_at: new Date().toISOString(),
    };
    validateEpochRecord(record, resourceScope, { home });
    readCloudExistingEpochCompletion(record, { home });
    await assertHeld();
    const path = join(directory, plan.task_id + '.json');
    const sha256 = save(path, record);
    const reference = freezeFenceReference({ scope: resourceScope, epochId: plan.task_id, home });
    need(reference.path === path && reference.sha256 === sha256, 'ISSUE_READBACK');
    save(join(journal, 'record-issued.json'), reference);
    return reference;
  };
}

const readBoundRouteDigests = daemons => ({ old: digest(daemons.old), next: digest(daemons.next) });

function createDisconnect(reads) {
  const expectedScope = { endpoint: route.old_endpoint, serial: route.serial };
  return async ({ scope, assertAuthority, assertCandidate, before, journal }) => {
    need(same(scope, expectedScope) && reads.daemons.old.endpoint === scope.endpoint, 'DISCONNECT_SCOPE');
    const { lease } = await assertAuthority();
    await reads.verifyRoutes({ lease, assertAuthority, before });
    await assertCandidate();
    const directory = join(privateDirectory(journal), 'disconnect-wire');
    mkdirSync(directory, { mode: 0o700 });
    return hostOperation({ operation: 'disconnect', scope: expectedScope, directory,
      async readAuthority() {
        const current = await assertAuthority();
        readBoundAdbDaemon(reads.daemons.old);
        readBoundAdbDaemon(reads.daemons.next);
        need(reads.assertConsumerAbsent() === before.consumer_readback_sha256, 'OLD_CONSUMER_ACTIVE');
        return { scope: expectedScope, authorized_action: 'disconnect', lease_until: current.lease.expires_at };
      } });
  };
}

function createPostReleaseCheck(reads, plan) {
  return async ({ proof, authority, assertHeld, journal }) => {
    const assertReleased = async () => {
      await assertHeld();
      const { task, originalTask, deviceLocks } = await reads.readAuthority();
      const rows = deviceLocks.locks?.filter(row => row.device_name === route.serial);
      need(task.id === plan.task_id && task.status === 'in_progress' && task.claimed_by === plan.claim.claimed_by
        && task.claimed_at === plan.claim.claimed_at
        && digest(task.result?.cloud_phone_101_route_fence_approval) === authority.approval_sha256
        && originalTask.status === 'blocked' && originalTask.result?.execution_stopped !== true
        && deviceLocks.success === true && rows?.length === 1 && rows[0].expired !== true
        && Object.keys(proof.current).every(key => rows[0][key] === proof.current[key]), 'POST_RELEASE_DRIFT');
      await assertHeld();
      return authority;
    };
    const after = JSON.parse(readPrivatePolicy(join(journal, 'after.json')));
    await reads.verifyRoutes({ lease: plan.lease, assertAuthority: assertReleased, before: after });
    await assertReleased();
  };
}

export async function cloudFenceMain([operation, sourceCommit, input, stateFile, authRef, ...extra]) {
  const planning = operation === 'cloud-101-fence-plan';
  need((planning || operation === 'cloud-101-fence-apply') && extra.length === 0
    && /^[a-f0-9]{40}$/.test(sourceCommit ?? '') && input && stateFile && authRef, 'USAGE');
  const home = userInfo().homedir;
  need(here === join(home, '.local/share/zenithjoy/phone-candidates', sourceCommit, 'runtime')
    && cloudSource().commit === sourceCommit, 'EXECUTION_SOURCE');
  const serialRoot = join(home, '.local/share/zenithjoy/device-epoch-migrations', route.serial);
  ensureRecordRoot(serialRoot);
  const journalRoot = join(serialRoot, 'cloud-test-5041-to-5042');
  try { mkdirSync(journalRoot, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  privateDirectory(journalRoot);
  let plan;
  if (!planning) {
    need(resolve(input) === input && dirname(dirname(input)) === journalRoot
      && basename(dirname(input)).startsWith('plan-') && basename(input) === 'plan.json', 'PLAN_PATH');
    privateDirectory(dirname(input));
    const stored = JSON.parse(readPrivatePolicy(input));
    plan = stored.plan;
    need(stored.plan_sha256 === digest(plan) && plan.source_commit === sourceCommit, 'PLAN_INPUT');
  }
  const taskId = planning ? input : plan.task_id;
  const scratchRoot = mkdtempSync(join(journalRoot, planning ? 'plan-' : 'apply-'));
  const reads = await createCloudHostReads({ sourceCommit, taskId, stateFile, authRef, scratchRoot, home });
  const node = reads.host.executables.node;
  need(process.execPath === node.path && digest(bytes(node.path)) === node.sha256, 'EXECUTION_NODE');
  const withDeviceGuard = (serial, callback) => withCloudDeviceGuard({ serial, python: reads.host.executables.python, home }, callback);
  if (planning) {
    const proposal = await withDeviceGuard(route.serial, async (guard) => {
      const result = await createCloudFencePlan({ taskId, sourceCommit }, {
        ...reads,
        observe: (phase, authority) => reads.observe(phase, { ...authority, assertHeld: guard.assertHeld }),
      });
      await guard.assertHeld();
      return result;
    });
    const planPath = join(scratchRoot, 'plan.json');
    save(planPath, proposal);
    return { ...proposal, plan_path: planPath };
  }
  return applyCloudFencePlan({ plan, journalRoot, io: {
    ...reads,
    withDeviceGuard,
    disconnect: createDisconnect(reads),
    issueAdmission: createCloudEpochIssuer({ daemons: reads.daemons, host: reads.host, instance: reads.instance,
      centralRead: path => reads.readBrain(path.slice('/api/brain'.length)),
      assertPostRelease: createPostReleaseCheck(reads, plan), home }),
  } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await cloudFenceMain(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const code = error.code || error.message;
    process.stderr.write((/^CLOUD_[A-Z_]+$/.test(code) ? code : 'CLOUD_EXECUTION_UNKNOWN') + '\n');
    process.exitCode = 2;
  }
}
