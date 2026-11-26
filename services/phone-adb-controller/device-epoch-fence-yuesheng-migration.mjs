import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory, save } from './device-epoch-fence-files.mjs';
import { canonical, digest } from './device-epoch-fence-reference.mjs';
import { parseHostAction } from './device-epoch-fence-transport.mjs';
import { verifyYueshengBefore, verifyYueshengBetween, verifyYueshengMigrationReadback, yueshengMigrationRoute } from './device-epoch-fence-yuesheng-readback.mjs';

const actions = Object.freeze(['disconnect_old', 'connect_new']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hexDigest = /^[a-f0-9]{64}$/;
const same = (a, b) => canonical(a) === canonical(b);
const leaseKeys = ['device_name', 'locked_by', 'locked_at', 'expires_at', 'lease_version', 'expired'];

function need(value, condition) {
  if (value) return;
  const code = `YUESHENG_MIGRATION_${condition}`;
  throw Object.assign(Error(code), { code });
}

function assertNoJournal(path) {
  try { lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  need(false, 'REPLAY');
}

function reserveJournal(root, path) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') need(false, 'REPLAY'); throw error; }
  privateDirectory(path, true);
  const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function assertPlan(plan) {
  need(plan?.protocol === 'yuesheng-adb-migration-plan/v1' && uuid.test(plan.task_id ?? '')
    && uuid.test(plan.pending_action_id ?? '') && uuid.test(plan.release_id ?? '') && uuid.test(plan.observation_id ?? '')
    && /^[a-f0-9]{40}$/.test(plan.source_commit ?? '')
    && Object.entries(yueshengMigrationRoute).every(([key, value]) => plan[key] === value), 'PLAN');
  need(typeof plan.claim?.claimed_by === 'string' && plan.claim.claimed_by.trim().length > 0
    && Number.isFinite(Date.parse(plan.claim.claimed_at)), 'PLAN_CLAIM');
  const lease = plan.lease;
  need(lease?.device_name === plan.physical_serial && lease.locked_by === plan.task_id && lease.expired === false
    && typeof lease.lease_version === 'string' && /^[1-9][0-9]{0,9}$/.test(lease.lease_version)
    && Number(lease.lease_version) <= 4_294_967_295 && Date.parse(lease.locked_at) >= Date.parse(plan.claim.claimed_at)
    && Date.parse(lease.expires_at) > Date.parse(lease.locked_at), 'PLAN_LEASE');
}

function verifyAuthority({ plan, planSha, snapshot, now }) {
  const { task, deviceLocks, pendingAction } = snapshot ?? {};
  need(task?.id === plan.task_id && task.status === 'in_progress' && task.claimed_by === plan.claim.claimed_by
    && task.claimed_at === plan.claim.claimed_at, 'AUTHORITY_TASK');
  const matching = deviceLocks?.success === true && Array.isArray(deviceLocks.locks)
    && deviceLocks.locks.filter(lease => lease.device_name === plan.physical_serial);
  need(matching?.length === 1 && leaseKeys.every(key => matching[0][key] === plan.lease[key])
    && Date.parse(plan.lease.expires_at) > now + 5_000, 'AUTHORITY_LEASE');
  const approval = task.result?.yuesheng_adb_migration_approval;
  const approvedAt = Date.parse(approval?.approved_at);
  need(approval?.protocol === 'yuesheng-adb-migration-approval/v1' && approval.plan_sha256 === planSha
    && same(approval.actions, actions) && approval.approved_by === 'authenticated-operator'
    && approval.approval_ref === 'pending-action:' + plan.pending_action_id
    && approvedAt >= Date.parse(plan.lease.locked_at) && approvedAt <= now
    && pendingAction?.id === plan.pending_action_id && pendingAction.status === 'approved'
    && pendingAction.action_type === 'owner_decision' && pendingAction.source === 'yuesheng_adb_migration'
    && same(pendingAction.params ?? null, { protocol: 'yuesheng-adb-migration-request/v1',
      task_id: task.id, device_name: plan.physical_serial, lease_version: plan.lease.lease_version, source_commit: plan.source_commit })
    && same(pendingAction.execution_result, approval), 'AUTHORITY_APPROVAL');
  return { task: { id: task.id, status: task.status, ...plan.claim }, lease: { ...plan.lease }, approvalSha: digest(approval) };
}

// A future production adapter must supply the actual guard, Brain reads and wire operations.
// This module has no CLI, default transport, automatic rollback, or epoch-record issuer.
export async function runYueshengMigration({ plan: proposedPlan, journalRoot, io }) {
  const plan = structuredClone(proposedPlan);
  assertPlan(plan);
  const planSha = digest(plan);
  const now = io.now ?? Date.now;
  const root = privateDirectory(journalRoot);
  const journal = join(root, 'yuesheng-5044-to-5045');
  assertNoJournal(journal);
  return io.withDeviceGuard(plan.physical_serial, async guard => {
    let approvalSha;
    const assertAuthority = async () => {
      await guard.assertHeld();
      const snapshot = await io.readAuthority();
      await guard.assertHeld();
      const verified = verifyAuthority({ plan, planSha, snapshot, now: now() });
      approvalSha ??= verified.approvalSha;
      need(verified.approvalSha === approvalSha, 'AUTHORITY_APPROVAL');
      return verified;
    };
    await assertAuthority();
    assertNoJournal(journal);
    const candidate = await io.readCandidate();
    const before = await io.observe('before');
    need(verifyYueshengBefore({ candidate, before }, now()) === plan.source_commit
      && candidate.manifest.release_id === plan.release_id && candidate.manifest.observation_id === plan.observation_id, 'PLAN_CANDIDATE');
    const beforeAuthority = await assertAuthority();
    need(Date.parse(before.observed_at) >= Date.parse(beforeAuthority.lease.locked_at), 'OBSERVATION_WINDOW');
    reserveJournal(root, journal);
    const persist = (name, value) => save(join(journal, `${name}.json`), value);
    let operation = 'prepare', operationStarted = false;
    async function operate(name, endpoint) {
      operation = name;
      operationStarted = false;
      const scope = Object.freeze({ endpoint, serial: plan.transport_serial });
      await assertAuthority();
      persist(`${name}-intent`, { operation: name, scope, plan_sha256: planSha, at: new Date(now()).toISOString() });
      await assertAuthority();
      let receipt;
      operationStarted = true;
      try { receipt = await io.operate({ operation: name, scope, assertAuthority }); }
      catch { need(false, 'OPERATION_UNKNOWN'); }
      need(receipt?.protocol === 'device-epoch-fence-host-operation/v1' && receipt.operation === name
        && same(receipt.scope, scope) && receipt.wire_complete === true && receipt.peer_eof === true && receipt.socket_closed === true
        && receipt.pending === 0 && receipt.write_attempted === true && receipt.write_acknowledged === true
        && receipt.action_confirmed === true && receipt.error_code === null && receipt.action_error_code === null
        && hexDigest.test(receipt.raw_sha256 ?? '') && parseHostAction(name, plan.transport_serial, receipt.response).action_confirmed, 'OPERATION_UNKNOWN');
      persist(`${name}-result`, receipt);
      return now();
    }
    try {
      persist('plan', { plan, plan_sha256: planSha, approval_sha256: approvalSha });
      persist('before', { ...before, lock: beforeAuthority.lease });
      const disconnectedAt = await operate('disconnect', plan.old_endpoint);
      const between = await io.observe('between');
      persist('between', between);
      const betweenAt = Date.parse(between?.observed_at);
      need(disconnectedAt <= betweenAt && betweenAt <= now(), 'OBSERVATION_WINDOW');
      verifyYueshengBetween(between);
      const connectedAt = await operate('connect', plan.new_endpoint);
      const after = await io.observe('after');
      const afterAt = Date.parse(after?.observed_at);
      need(connectedAt <= afterAt && afterAt <= now(), 'OBSERVATION_WINDOW');
      const final = await assertAuthority();
      const afterReadback = { ...after, lock: final.lease };
      persist('after', afterReadback);
      const observation = verifyYueshengMigrationReadback({ task: final.task, candidate,
        before: { ...before, lock: beforeAuthority.lease }, after: afterReadback, current_lock: final.lease }, now());
      const result = { protocol: 'yuesheng-adb-migration-transaction/v1', status: 'observed', plan_sha256: planSha, observation };
      persist('complete', result);
      return result;
    } catch (error) {
      const code = /^YUESHENG_MIGRATION_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'YUESHENG_MIGRATION_UNKNOWN';
      persist('unknown', { status: 'unknown', plan_sha256: planSha, operation, operation_started: operationStarted, error_code: code, retry_allowed: false });
      throw error;
    }
  });
}
