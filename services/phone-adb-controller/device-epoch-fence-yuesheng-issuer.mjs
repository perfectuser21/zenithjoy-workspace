import { join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readReleaseProof, releaseCentralLease } from './device-epoch-fence-central.mjs';
import { ensureRecordRoot, privateDirectory, save } from './device-epoch-fence-files.mjs';
import { bytes, canonical, digest, freezeFenceReference, readPrivatePolicy, validateEpochRecord } from './device-epoch-fence-reference.mjs';
import { reviewSource } from './device-epoch-fence-review.mjs';
import { parseHostAction } from './device-epoch-fence-transport.mjs';
import { verifyYueshengBefore, verifyYueshengBetween, verifyYueshengMigrationReadback, yueshengMigrationRoute as route } from './device-epoch-fence-yuesheng-readback.mjs';
import { maintenanceBrainRequest } from './qualification-maintenance-brain.mjs';

const bindingFiles = ['device-epoch-fence-yuesheng-host-reads.mjs', 'yuesheng-adb-daemon-binding.py'];
const oldTaskId = 'e0bc29b4-cc71-43b7-8e3d-cc634327fd68';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const same = (left, right) => canonical(left) === canonical(right);
const need = (condition, reason) => {
  if (!condition) {
    const code = 'YUESHENG_MIGRATION_' + reason;
    throw Object.assign(new Error(code), { code });
  }
};

export async function readYueshengPreviousClearance(currentTask, { read = maintenanceBrainRequest } = {}) {
  const release = currentTask?.result?.old_101_production_device_release;
  need(currentTask?.payload?.old_101_task === oldTaskId && release?.readback_owner === null
    && release.outcome?.task_id === oldTaskId && release.outcome.resources_released === true
    && /^[1-9][0-9]*$/.test(release.free_version ?? ''), 'PREVIOUS_CLEARANCE');
  const task = await read('/tasks/' + oldTaskId);
  const review = task?.result?.native_agent_resource_review;
  need(task?.id === oldTaskId && task.status === 'completed_no_pr' && task.payload?.device_serial === route.physical_serial
    && task.payload.run_id === release.outcome.run_id && review?.protocol === 'native-agent-resource-settlement/v1'
    && review.task_id === task.id && review.run_id === task.payload.run_id && review.review_event_id === release.outcome.review_event_id
    && review.basis === 'operator-cleanup-review' && review.review?.actor === 'authenticated-operator'
    && review.review.effects_reviewed === true && review.review.cleanup_confirmed === true
    && review.devices?.length === 1 && review.devices[0].device_name === route.physical_serial
    && uuid.test(review.pending_action_id ?? '') && sha.test(review.receipt_sha256 ?? ''), 'PREVIOUS_CLEARANCE');
  const value = await read('/pending-actions/' + review.pending_action_id);
  const action = value?.action ?? value;
  need(action?.id === review.pending_action_id && action.status === 'approved' && action.action_type === 'owner_decision'
    && action.params?.task_id === oldTaskId && same(action.execution_result, review), 'PREVIOUS_CLEARANCE');
  return { task_id: task.id, run_id: review.run_id, review_event_id: review.review_event_id,
    settlement_sha256: digest(review), pending_action_sha256: digest(action) };
}

function journalStep(journal, operation, plan, planSha) {
  const endpoint = operation === 'disconnect' ? route.old_endpoint : route.new_endpoint;
  const scope = { endpoint, serial: route.transport_serial };
  const intent = JSON.parse(readPrivatePolicy(join(journal, operation + '-intent.json')));
  const result = JSON.parse(readPrivatePolicy(join(journal, operation + '-result.json')));
  const wire = privateDirectory(join(journal, operation + '-wire'));
  const raw = readPrivatePolicy(join(wire, 'host-response.raw'));
  need(intent.operation === operation && intent.plan_sha256 === planSha && same(intent.scope, scope)
    && Date.parse(intent.at) >= Date.parse(plan.lease.locked_at) && Date.parse(intent.at) < Date.parse(plan.lease.expires_at)
    && result.operation === operation && same(result.scope, scope) && result.wire_complete === true
    && result.peer_eof === true && result.socket_closed === true && result.pending === 0
    && result.raw_sha256 === digest(raw) && result.action_confirmed === true
    && result.write_attempted === true && result.write_acknowledged === true
    && /^OKAY[0-9a-fA-F]{4}$/.test(raw.subarray(0, 8).toString('ascii'))
    && Number.parseInt(raw.subarray(4, 8).toString('ascii'), 16) === raw.length - 8
    && Buffer.from(result.response, 'utf8').equals(raw.subarray(8))
    && parseHostAction(operation, scope.serial, result.response).action_confirmed
    && same(result, JSON.parse(readPrivatePolicy(join(wire, 'result.json')))), 'ISSUE_WIRE');
  return result.raw_sha256;
}

function readRegistration() {
  const registry = JSON.parse(bytes(fileURLToPath(new URL('./config/adb-host-instances.json', import.meta.url))));
  const sources = JSON.parse(bytes(fileURLToPath(new URL('./config/collection-phone-hosts.json', import.meta.url))));
  const profiles = sources.hosts.filter(entry => entry.target === 'mmv' && entry.serial === route.physical_serial);
  const policies = registry.instances.filter(entry => entry.instance_id === route.new_instance_id);
  need(profiles.length === 1 && policies.length === 1, 'ISSUE_SCOPE');
  return { host: profiles[0], policy: policies[0] };
}

export function createYueshengEpochIssuer({
  daemons, bindDaemon, readCompany, previousClearance, source = reviewSource,
  release = releaseCentralLease, releaseProof = readReleaseProof, now = Date.now,
  home = userInfo().homedir, registration = readRegistration, ensureRecords = ensureRecordRoot,
}) {
  const root = privateDirectory(join(home, '.local/share/zenithjoy'));
  const line = 'yuesheng';
  return async ({ journal, plan, candidate, result, assertAuthority, assertHeld }) => {
    const planSha = digest(plan);
    const scope = { maintenance_task_id: plan.task_id, serial: route.physical_serial, claim: plan.claim };
    const check = await assertAuthority();
    const proofPlan = JSON.parse(readPrivatePolicy(join(journal, 'plan.json')));
    const completeRaw = readPrivatePolicy(join(journal, 'complete.json'));
    const before = JSON.parse(readPrivatePolicy(join(journal, 'before.json')));
    const between = JSON.parse(readPrivatePolicy(join(journal, 'between.json')));
    const after = JSON.parse(readPrivatePolicy(join(journal, 'after.json')));
    need(journal === join(root, 'device-epoch-migrations', route.physical_serial, 'yuesheng-5044-to-5045')
      && same(proofPlan, { plan, plan_sha256: planSha, approval_sha256: check.approvalSha })
      && same(JSON.parse(completeRaw), result) && result.plan_sha256 === planSha, 'ISSUE_JOURNAL');
    verifyYueshengBefore({ candidate, before }, now());
    verifyYueshengBetween(between);
    const observation = verifyYueshengMigrationReadback({
      task: check.task, candidate, before, after, current_lock: check.lease,
    }, now());
    need(same(observation, result.observation), 'ISSUE_OBSERVATION');
    const wire = Object.fromEntries(['disconnect', 'connect'].map(action => [action, journalStep(journal, action, plan, planSha)]));

    const bindingSha = Object.fromEntries(bindingFiles.map(name => {
      const entries = candidate.manifest.files.filter(entry => entry.deployed_path === name);
      need(entries.length === 1 && entries[0].path === 'services/phone-adb-controller/' + name
        && sha.test(entries[0].content_sha256 ?? ''), 'ISSUE_SOURCE');
      return [name, entries[0].content_sha256];
    }));
    const runtimeSource = source();
    const company = await readCompany(line);
    const { host, policy } = registration();
    need(host.target === 'mmv' && host.profile === 'wuying_android14' && host.serial === route.physical_serial
      && policy.kind === 'managed' && policy.instance_id === route.new_instance_id
      && policy.policy.endpoint === route.new_endpoint && runtimeSource.commit === plan.source_commit
      && uuid.test(company?.company_id ?? '') && uuid.test(company?.tenant_id ?? '') && Number.isSafeInteger(company.version)
      && company.version > 0 && typeof company.policy_id === 'string' && company.policy_id.length > 0, 'ISSUE_SCOPE');
    const policyRaw = readPrivatePolicy(policy.policy_path);
    need(same(JSON.parse(policyRaw), policy.policy), 'ISSUE_POLICY');
    const [old, next] = await Promise.all([bindDaemon(daemons.old), bindDaemon(daemons.next)]);
    need(same(old, daemons.old) && same(next, daemons.next), 'ISSUE_DAEMONS');
    const directory = join(root, 'device-epoch-fences', route.physical_serial);
    ensureRecords(directory);
    save(join(journal, 'central-release-intent.json'), { plan_sha256: planSha, scope, lease: check.lease });
    const response = await release({ scope, lease: check.lease, readAuthority: assertAuthority });
    if (response.status !== 'released') {
      const errorCode = /^CENTRAL_[A-Z_]+$/.test(response.error_code ?? '') ? response.error_code : 'CENTRAL_ACK_UNKNOWN';
      save(join(journal, 'central-release-unknown.json'), { status: 'unknown', error_code: errorCode, retry_allowed: false });
      need(false, 'ISSUE_RELEASE');
    }
    const central = releaseProof(response.receipt);
    save(join(journal, 'central-release-result.json'), central);
    await assertHeld();

    const record = {
      protocol: 'device-epoch-fence-record/v1', status: 'fenced', authority_basis: 'approved-clean-route-migration/v1',
      original_execution_stopped: false, android_internal: 'not_attested', epoch_id: plan.task_id,
      resource: { serial: route.physical_serial, adb_serial: route.transport_serial, profile: host.profile,
        expected_account: host.expected_account, line, company },
      old_route: { endpoint: old.endpoint, daemon_binding: old },
      new_route: { endpoint: next.endpoint, instance_id: policy.instance_id, policy_path: policy.policy_path,
        policy_sha256: digest(policyRaw), daemon_binding: next },
      runtime_source: runtimeSource,
      migration: { journal_path: journal, plan_sha256: planSha, approval_sha256: check.approvalSha,
        completion_sha256: digest(completeRaw), central_release: central, release_id: plan.release_id,
        observation_id: plan.observation_id, binding_sha256: bindingSha, previous_clearance: previousClearance, wire_sha256: wire },
      created_at: new Date(now()).toISOString(),
    };
    const resourceScope = { ...host, policy: policy.policy, source_commit: plan.source_commit };
    validateEpochRecord(record, resourceScope, { home });
    const path = join(directory, plan.task_id + '.json');
    const sha256 = save(path, record);
    const reference = freezeFenceReference({ scope: resourceScope, epochId: plan.task_id, home });
    need(reference.path === path && reference.sha256 === sha256, 'ISSUE_READBACK');
    save(join(journal, 'record-issued.json'), reference);
    return reference;
  };
}
