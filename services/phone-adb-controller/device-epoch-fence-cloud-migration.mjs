import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory, save } from './device-epoch-fence-files.mjs';
import { canonical, digest } from './device-epoch-fence-reference.mjs';
import { parseHostAction } from './device-epoch-fence-transport.mjs';

export const cloudFenceRoute = Object.freeze({
  serial: '47.100.213.173:10001',
  profile: 'cloud-phone-test',
  old_endpoint: 'tcp:127.0.0.1:5041',
  new_endpoint: 'tcp:127.0.0.1:5042',
  instance_id: 'mmv-cloud-epoch2',
});
export const cloudFenceOriginal = Object.freeze({
  task_id: '0874e3fc-b7c2-46a6-b97e-cdc1264a693c',
  run_id: '867d15ae-69d7-455b-b8db-4f0299bce291',
});
const planProtocol = 'cloud-phone-101-route-fence-plan/v1';
export const cloudFenceOperator = Object.freeze({
  task_id: '8c3b3479-3565-4f62-b211-9abbb898d740',
  choice: '只切换抖音 101 专用测试设备，从旧 5041 断开这一台设备，独立核验现有 5042 后继续 101',
});
const approvalRef = 'task:' + cloudFenceOperator.task_id + ':phone_101_single_device_switch';
const approvalKey = 'cloud_phone_101_route_fence_approval';
const actions = Object.freeze(['disconnect_old_serial']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commit = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const leaseKeys = ['device_name', 'locked_by', 'locked_at', 'expires_at', 'lease_version', 'expired'];
const candidateKeys = ['source_commit', 'release_id', 'observation_id', 'manifest_sha256', 'resource'];
const pinnedObservationKeys = ['provider_binding_sha256', 'hardware_serial_sha256', 'boot_id_sha256',
  'old_daemon_sha256', 'new_daemon_sha256', 'consumer_readback_sha256'];
const scope = Object.freeze({ endpoint: cloudFenceRoute.old_endpoint, serial: cloudFenceRoute.serial });
const same = (a, b) => canonical(a) === canonical(b);
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));

export function requireCloudFence(condition, detail) {
  if (condition) return;
  const code = 'CLOUD_FENCE_' + detail;
  throw Object.assign(new Error(code), { code });
}

function assertNoIntent(path) {
  try { lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  requireCloudFence(false, 'REPLAY');
}

function inspectAuthority(snapshot, request, now, approvalPlan) {
  const { task, originalTask, operatorTask, deviceLocks } = snapshot ?? {};
  requireCloudFence(task?.id === request.taskId && task.status === 'in_progress'
    && typeof task.claimed_by === 'string' && task.claimed_by.trim() && Date.parse(task.claimed_at) <= now
    && task.payload?.work_kind === 'coding_review' && task.payload.headed_manual === true
    && same(task.payload.scope, ['switch_mmv_cloud_101_to_5042'])
    && task.payload.source_task_id === cloudFenceOriginal.task_id && task.payload.source_run_id === cloudFenceOriginal.run_id, 'TASK');
  requireCloudFence(originalTask?.id === cloudFenceOriginal.task_id && originalTask.status === 'blocked'
    && originalTask.result?.execution_stopped !== true, 'ORIGINAL');
  const rows = deviceLocks?.success === true && Array.isArray(deviceLocks.locks)
    && deviceLocks.locks.filter(row => row.device_name === cloudFenceRoute.serial);
  const lease = rows?.[0], lockedAt = Date.parse(lease?.locked_at);
  requireCloudFence(rows?.length === 1 && lease.locked_by === request.taskId && lease.expired === false
    && typeof lease.lease_version === 'string' && /^[1-9][0-9]{0,9}$/.test(lease.lease_version)
    && Number(lease.lease_version) <= 4294967295 && Date.parse(task.claimed_at) <= lockedAt && lockedAt <= now
    && Date.parse(lease.expires_at) > now + 5000, 'LEASE');
  const identity = { claim: pick(task, ['claimed_by', 'claimed_at']), lease: pick(lease, leaseKeys) };
  if (approvalPlan) requireCloudFence(same(identity.claim, approvalPlan.claim) && same(identity.lease, approvalPlan.lease), 'AUTHORITY_DRIFT');
  const approval = task.result?.[approvalKey];
  const choice = operatorTask?.result?.phone_101_single_device_switch;
  requireCloudFence(operatorTask?.id === cloudFenceOperator.task_id && choice?.operator_authorized === true
    && choice.authorized_scope === cloudFenceOperator.choice && choice.actor === 'interactive-dev-skill'
    && choice.old_route === 'unauthorized' && choice.new_route === 'device'
    && choice.device_mutated === false && choice.business_started === false
    && Date.parse(choice.recorded_at) <= now, 'USER_AUTHORIZATION');
  if (!approvalPlan) return identity;
  requireCloudFence(same(Object.keys(approval ?? {}).sort(),
    ['actions', 'approval_ref', 'approved_at', 'approved_by', 'plan_sha256', 'protocol'])
    && approval.protocol === 'cloud-phone-101-route-fence-approval/v1' && approval.plan_sha256 === digest(approvalPlan)
    && same(approval.actions, actions) && approval.approved_by === 'authenticated-operator'
    && approval.approval_ref === approvalRef && Date.parse(approval.approved_at) >= Date.parse(choice.recorded_at)
    && Date.parse(approval.approved_at) >= Date.parse(approvalPlan.before.observed_at)
    && Date.parse(approval.approved_at) <= now, 'APPROVAL');
  return { ...identity, approval_sha256: digest(approval), approved_at: approval.approved_at, authorization: structuredClone(approval) };
}

function candidateIdentity(value, request) {
  const { manifest, gate, resource } = value ?? {};
  requireCloudFence(manifest?.target === 'mmv' && manifest.source_repo === 'perfectuser21/zenithjoy-workspace'
    && manifest.source_commit === request.sourceCommit && manifest.environment === 'staging:' + request.sourceCommit
    && uuid.test(manifest.release_id ?? '') && uuid.test(manifest.observation_id ?? '')
    && sha256.test(manifest.manifest_sha256 ?? '') && gate?.release_id === manifest.release_id
    && gate.current_observation_id === manifest.observation_id && gate.deployed === true && gate.actual_matches === true, 'CANDIDATE');
  requireCloudFence(resource?.serial === cloudFenceRoute.serial && resource.profile === cloudFenceRoute.profile
    && /^\d{6,32}$/.test(resource.expected_account ?? '') && resource.line === 'yuesheng'
    && uuid.test(resource.company?.company_id ?? '') && uuid.test(resource.company?.tenant_id ?? '')
    && Number.isSafeInteger(resource.company.version) && resource.company.version > 0
    && typeof resource.company.policy_id === 'string' && resource.company.policy_id.trim(), 'RESOURCE');
  return { source_commit: manifest.source_commit, release_id: manifest.release_id, observation_id: manifest.observation_id,
    manifest_sha256: manifest.manifest_sha256, resource: structuredClone(resource) };
}

function deviceAt(row, state) {
  return row?.serial === cloudFenceRoute.serial && row.state === state && typeof row.properties === 'string';
}

function validateObservation(observation, phase, now, earliest) {
  const seenAt = Date.parse(observation?.observed_at);
  requireCloudFence(Number.isFinite(seenAt) && seenAt >= earliest && seenAt <= now && now - seenAt <= 30000, 'OBSERVATION_WINDOW');
  requireCloudFence([...pinnedObservationKeys, 'noninterference_sha256'].every(key => sha256.test(observation[key] ?? ''))
    && (phase === 'after' ? observation.old_device === null : deviceAt(observation.old_device, 'unauthorized'))
    && deviceAt(observation.new_device, 'device'), 'OBSERVATION');
  return seenAt;
}

function requireRequest({ taskId, sourceCommit }) {
  requireCloudFence(uuid.test(taskId ?? '') && taskId !== cloudFenceOriginal.task_id
    && commit.test(sourceCommit ?? ''), 'REQUEST');
}

export async function createCloudFencePlan(request, io) {
  requireRequest(request);
  const now = io.now ?? Date.now;
  const first = inspectAuthority(await io.readAuthority(), request, now());
  const candidate = candidateIdentity(await io.readCandidate(), request);
  const before = await io.observe('before', first);
  validateObservation(before, 'before', now(), Date.parse(first.lease.locked_at));
  const latest = inspectAuthority(await io.readAuthority(), request, now());
  requireCloudFence(same(first, latest) && same(candidateIdentity(await io.readCandidate(), request), candidate), 'AUTHORITY_DRIFT');
  const plan = { protocol: planProtocol, task_id: request.taskId, operator_approval_task_id: cloudFenceOperator.task_id,
    ...candidate, ...first, route: { ...cloudFenceRoute }, original: { ...cloudFenceOriginal }, before: structuredClone(before) };
  return { plan, plan_sha256: digest(plan) };
}

function validateDisconnect(receipt) {
  requireCloudFence(receipt?.protocol === 'device-epoch-fence-host-operation/v1' && receipt.operation === 'disconnect'
    && same(receipt.scope, scope) && receipt.wire_complete === true && receipt.peer_eof === true
    && receipt.socket_closed === true && receipt.pending === 0 && receipt.write_attempted === true
    && receipt.write_acknowledged === true && receipt.action_confirmed === true && receipt.error_code === null
    && receipt.action_error_code === null && receipt.retry_allowed === false && receipt.original_execution_stopped === false
    && sha256.test(receipt.raw_sha256 ?? '')
    && parseHostAction('disconnect', cloudFenceRoute.serial, receipt.response).action_confirmed, 'DISCONNECT_UNKNOWN');
}

export async function applyCloudFencePlan({ plan: proposed, journalRoot, io }) {
  const plan = structuredClone(proposed);
  requireCloudFence(plan?.protocol === planProtocol && same(plan.route, cloudFenceRoute) && same(plan.original, cloudFenceOriginal)
    && plan.operator_approval_task_id === cloudFenceOperator.task_id, 'PLAN');
  const request = { taskId: plan.task_id, sourceCommit: plan.source_commit };
  requireRequest(request);
  const now = io.now ?? Date.now;
  const root = privateDirectory(journalRoot);
  const intentPath = join(root, 'disconnect-intent.json');
  const journal = join(root, plan.task_id);
  assertNoIntent(intentPath);
  assertNoIntent(journal);
  const approval = inspectAuthority(await io.readAuthority(), request, now(), plan);
  return io.withDeviceGuard(cloudFenceRoute.serial, async (guard) => {
    const assertAuthority = async () => {
      await guard.assertHeld();
      const snapshot = await io.readAuthority();
      await guard.assertHeld();
      const current = inspectAuthority(snapshot, request, now(), plan);
      requireCloudFence(same(approval, current), 'AUTHORITY_DRIFT');
      return current;
    };
    const assertCandidate = async () => requireCloudFence(
      same(candidateIdentity(await io.readCandidate(), request), pick(plan, candidateKeys)), 'CANDIDATE_DRIFT');
    await assertAuthority();
    await assertCandidate();
    const before = await io.observe('before', { ...approval, assertAuthority });
    validateObservation(before, 'before', now(), Date.parse(approval.approved_at));
    requireCloudFence(same(pick(before, [...pinnedObservationKeys, 'old_device', 'new_device']),
      pick(plan.before, [...pinnedObservationKeys, 'old_device', 'new_device'])), 'OBSERVATION_DRIFT');
    await assertCandidate();
    await assertAuthority();
    assertNoIntent(intentPath);
    try { mkdirSync(journal, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') requireCloudFence(false, 'REPLAY'); throw error; }
    privateDirectory(journal, true);
    const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }

    const planSha = digest(plan);
    const persist = (name, value) => save(join(journal, name + '.json'), value);
    const intent = { scope, plan_sha256: planSha, at: new Date(now()).toISOString() };
    let operation = 'prepare';
    try {
      persist('plan', { plan, plan_sha256: planSha, approval_sha256: approval.approval_sha256 });
      persist('approval', approval.authorization);
      const beforeSha = persist('before', before);
      await assertAuthority();
      persist('disconnect-intent', intent);
      operation = 'disconnect';
      // This root-wide exclusive marker covers retried plans with any task ID.
      try { save(intentPath, { ...intent, task_id: plan.task_id }); }
      catch (error) { if (error.code === 'EEXIST') requireCloudFence(false, 'REPLAY'); throw error; }
      const receipt = await io.disconnect({ scope, assertAuthority, assertCandidate, journal, before });
      validateDisconnect(receipt);
      persist('disconnect-result', receipt);
      const acknowledgedAt = now();
      operation = 'verify';
      const after = await io.observe('after', { ...approval, assertAuthority });
      validateObservation(after, 'after', now(), acknowledgedAt);
      requireCloudFence(same(pick(after, [...pinnedObservationKeys, 'new_device']),
        pick(before, [...pinnedObservationKeys, 'new_device'])), 'OBSERVATION_DRIFT');
      await assertCandidate();
      await assertAuthority();
      const afterSha = persist('after', after);
      const result = { protocol: 'cloud-test-adb-fence-transaction/v1', status: 'observed', plan_sha256: planSha,
        original_execution_stopped: false, before_sha256: beforeSha, after_sha256: afterSha, wire_sha256: receipt.raw_sha256,
        ...pick(after, ['hardware_serial_sha256', 'boot_id_sha256']) };
      const completionSha = persist('complete', result);
      if (!io.issueAdmission) return result;
      operation = 'issue_admission';
      const epochReference = await io.issueAdmission({ plan, journal, result, completionSha, assertAuthority, assertCandidate,
        assertHeld: () => guard.assertHeld() });
      return { ...result, epoch_reference: epochReference };
    } catch (error) {
      persist('unknown', { status: 'unknown', plan_sha256: planSha, operation,
        error_code: /^CLOUD_FENCE_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'CLOUD_FENCE_UNKNOWN', retry_allowed: false });
      throw error;
    }
  });
}
