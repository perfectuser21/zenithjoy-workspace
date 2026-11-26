import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir, userInfo } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { digest } from '../runtime-definition.mjs';
import { selectPublicPreflightScope, freezePublicPreflightRoute } from '../public-preflight-route.mjs';
import { preparePublicDomainSnapshot } from '../public-domain-snapshot.mjs';
import { freezePreflightProfile } from '../preflight-control-scope.mjs';
import { epochCompatibilityRecordScope } from '../epoch-source-compatibility.mjs';
import { readCloud101BusinessFacts, verifyEpochFacts } from '../device-epoch-fence-admission.mjs';
import { freezeFenceReference, readCloudExistingEpochCompletion, validateEpochRecord } from '../device-epoch-fence-reference.mjs';

const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const serial = '47.100.213.173:10001';
const expectedAccount = '77980009922';
const profile = 'cloud-phone-test';
const instance = 'mmv-cloud-epoch2';
const oldEndpoint = 'tcp:127.0.0.1:5041';
const newEndpoint = 'tcp:127.0.0.1:5042';
const commit = 'a'.repeat(40);

function fixture(home = userInfo().homedir) {
  const epochId = id('7');
  const taskId = id('1');
  const runId = id('2');
  const taskRunId = id('6');
  const claim = { claimed_by: 'maintainer', claimed_at: '2024-01-01T01:00:00Z' };
  const lockedAt = '2024-01-01T01:01:00Z';
  const expiresAt = '2024-01-01T01:06:00Z';
  const lease = { device_name: serial, locked_by: epochId, locked_at: lockedAt, expires_at: expiresAt, lease_version: '11' };
  const centralRelease = {
    scope: { maintenance_task_id: epochId, serial, claim },
    expected: lease,
    current: { device_name: serial, locked_by: null, locked_at: null, expires_at: null, lease_version: '12' }
  };
  const company = { company_id: id('a'), tenant_id: id('b'), policy_id: 'private-101', version: 1 };
  const policy = { schema_version: 2, host_id: 'mmv', transport: 'tcp', endpoint: newEndpoint, instance_id: instance };
  const daemon = {
    uid: process.getuid(), pid: 701, command: 'fixture adb server', start_identity: 'fixture old start',
    endpoint: oldEndpoint, executable: '/fixture/adb', executable_sha256: digest('adb'),
    policy_path: join(home, '.config/zenithjoy/adb-service.json'), policy_sha256: digest('old policy')
  };
  const newDaemon = {
    ...daemon, pid: 702, start_identity: 'fixture new start', endpoint: newEndpoint, instance_id: instance,
    policy_path: join(home, '.config/zenithjoy/adb-instances', instance + '.json'),
    policy_sha256: digest(JSON.stringify(policy))
  };
  const source = { commit, files: { 'code.mjs': digest('runtime') } };
  const journal = join(home, '.local/share/zenithjoy/device-epoch-migrations', serial, 'cloud-test-5041-to-5042', epochId);
  const original = {
    task_id: '0874e3fc-b7c2-46a6-b97e-cdc1264a693c',
    run_id: '867d15ae-69d7-455b-b8db-4f0299bce291'
  };
  const releaseId = id('c');
  const observationId = id('d');
  const m = {
    journal_path: journal, plan_sha256: digest('plan'), approval_sha256: digest('approval'),
    completion_sha256: digest('completion'), release_id: releaseId, observation_id: observationId,
    wire_sha256: digest('wire'), central_release: centralRelease, hardware_serial_sha256: digest('android-hardware'),
    boot_id_sha256: digest('e'.repeat(8) + '-eeee-4eee-8eee-' + 'e'.repeat(12))
  };
  const record = {
    protocol: 'device-epoch-fence-record/v1', epoch_id: epochId, status: 'fenced',
    authority_basis: 'approved-existing-cloud-route-fence/v1', original_execution_stopped: false,
    android_internal: 'not_attested', original, resource: { profile, serial, expected_account: expectedAccount, company, line: 'yuesheng' },
    runtime_source: source, old_route: daemon, new_route: newDaemon, cloud_migration: m
  };
  const runBinding = {
    run_binding_id: id('3'), workflow_id: id('4'), workflow_definition_version_id: id('5'),
    attempt_key: taskId + ':1', activities: { preflight: { reference_id: id('a'), activity_id: id('b'), activity_definition_version_id: id('c') } }
  };
  const commonRunner = { task_id: taskId, run_id: runId, machine_id: 'us-mac-m4', profile_sha256: digest('profile'), run_binding: runBinding };
  const spec = {
    target: 'mmv', source_commit: commit, profile, serial, expected_account: expectedAccount, policy,
    policy_binding: { policy_path: newDaemon.policy_path, policy_sha256: newDaemon.policy_sha256 }
  };
  const frozen = {
    discovery_phone_scope: spec, deployment: { target: 'mmv', source_commit: commit, observation_id: observationId, release_id: releaseId, environment: 'staging:' + commit },
    release: { id: releaseId, manifest_sha256: digest('release manifest'), target: 'mmv', environment: 'staging:' + commit }, execution_mode: 'code', files: { 'runtime/code.mjs': source.files['code.mjs'] },
    public_domain: { ...commonRunner, protocol: 'workflow-domain/v1', company },
    run_identity: { tag: 'current-run', capability: 'douyin_video_discovery' },
    workflow_version: { id: runBinding.workflow_definition_version_id, payload: { key: 'douyin_video_discovery' } }
  };
  const facts = {
    record, frozen, task: { id: taskId, status: 'in_progress', claimed_by: 'common-runner', result: { common_runner: commonRunner } },
    binding: {
      id: runBinding.run_binding_id, source_kind: 'internal', run_id: runId, workflow_id: runBinding.workflow_id,
      workflow_definition_version_id: runBinding.workflow_definition_version_id, attempt_key: runBinding.attempt_key,
      release_id: releaseId, observation_id: observationId, task_run_id: taskRunId, payload: { runtime_snapshot_sha256: digest(source.files) }
    },
    links: { task_id: taskId, task_run_id: taskRunId },
    taskRun: { id: taskRunId, task_id: taskId, run_id: runId, status: 'running', ended_at: null },
    central: { device_name: serial, locked_by: taskId, expires_at: new Date(Date.now() + 60_000).toISOString(), expired: false, lease_version: '13' },
    oldDaemon: daemon, newDaemon, oldInventory: [], newInventory: [{ serial, state: 'device' }],
    policySha256: newDaemon.policy_sha256, source, activeOwner: 'current-run\n', activeQuarantined: false,
    cloudCompletion: { completion_sha256: m.completion_sha256, manifest_sha256: frozen.release.manifest_sha256 }, cloudHardwareSerialSha256: m.hardware_serial_sha256, cloudBootIdSha256: m.boot_id_sha256,
    originalTask: { id: original.task_id, status: 'blocked' }
  };
  return { facts, spec, record, journal, lease, claim };
}

test('the existing-route epoch admits only the current 101 business task and leaves prior execution unknown', () => {
  const { facts } = fixture();
  const proof = verifyEpochFacts(facts);
  assert.equal(proof.authorized, true);
  assert.equal(proof.original_execution_stopped, false);
  assert.equal(proof.android_internal, 'not_attested');
  assert.equal(proof.task_id, facts.task.id);
  for (const change of [
    f => { f.cloudHardwareSerialSha256 = digest('different hardware'); },
    f => { f.cloudBootIdSha256 = digest('different boot'); },
    f => { f.cloudCompletion.completion_sha256 = digest('unverified journal'); },
    f => { f.cloudCompletion.manifest_sha256 = digest('different release'); },
    f => { f.record.cloud_migration.observation_id = id('f'); },
    f => { f.frozen.workflow_version.payload.key = 'douyin_video_processing'; },
    f => { f.frozen.deployment.target = 'xian-m4'; },
    f => { f.frozen.release.environment = 'production'; },
    f => { f.originalTask.status = 'completed'; },
    f => { f.originalTask.result = { execution_stopped: true }; },
    f => { f.oldInventory.push({ serial, state: 'unauthorized' }); },
    f => { f.central.locked_by = id('f'); }
  ]) {
    const bad = fixture().facts;
    change(bad);
    assert.throws(() => verifyEpochFacts(bad));
  }
});

function makeJournal({ facts, record, journal, lease, claim }) {
  const m = record.cloud_migration;
  const oldDevice = { serial, state: 'unauthorized', properties: 'transport_id:3' };
  const newDevice = { serial, state: 'device', properties: 'transport_id:9' };
  const before = {
    observed_at: '2024-01-01T01:02:01Z', old_device: oldDevice, new_device: newDevice,
    provider_binding_sha256: digest('provider'), hardware_serial_sha256: m.hardware_serial_sha256,
    boot_id_sha256: m.boot_id_sha256, old_daemon_sha256: digest(record.old_route), new_daemon_sha256: digest(record.new_route),
    consumer_readback_sha256: digest('no consumers'), noninterference_sha256: digest('initial checks')
  };
  const after = { ...before, observed_at: '2024-01-01T01:02:04Z', old_device: null, noninterference_sha256: digest('final checks') };
  const plan = {
    protocol: 'cloud-phone-101-route-fence-plan/v1', task_id: record.epoch_id,
    operator_approval_task_id: '8c3b3479-3565-4f62-b211-9abbb898d740',
    source_commit: commit, release_id: m.release_id, observation_id: m.observation_id,
    manifest_sha256: facts.frozen.release.manifest_sha256, claim, lease: { ...lease, expired: false },
    route: { serial, profile, old_endpoint: oldEndpoint, new_endpoint: newEndpoint, instance_id: instance },
    original: record.original, resource: record.resource, before: { ...before, observed_at: '2024-01-01T01:02:00Z' }
  };
  m.plan_sha256 = digest(plan);
  const approval = {
    protocol: 'cloud-phone-101-route-fence-approval/v1', approved_at: '2024-01-01T01:02:01Z',
    approved_by: 'authenticated-operator', approval_ref: 'task:' + plan.operator_approval_task_id + ':phone_101_single_device_switch',
    actions: ['disconnect_old_serial'], plan_sha256: m.plan_sha256
  };
  m.approval_sha256 = digest(approval);
  const scope = { endpoint: oldEndpoint, serial };
  const response = 'disconnected ' + serial + '\n';
  const raw = Buffer.from('OKAY' + Buffer.byteLength(response).toString(16).padStart(4, '0') + response);
  m.wire_sha256 = digest(raw);
  const wire = {
    protocol: 'device-epoch-fence-host-operation/v1', operation: 'disconnect', scope, response, raw_sha256: m.wire_sha256,
    wire_complete: true, action_confirmed: true, write_attempted: true, write_acknowledged: true,
    peer_eof: true, socket_closed: true, pending: 0, error_code: null, action_error_code: null,
    retry_allowed: false, original_execution_stopped: false
  };
  mkdirSync(join(journal, 'disconnect-wire'), { recursive: true, mode: 0o700 });
  const write = (name, value) => {
    const rawBytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + '\n');
    writeFileSync(join(journal, name), rawBytes, { mode: 0o600 });
    return digest(rawBytes);
  };
  write('plan.json', { plan, plan_sha256: m.plan_sha256, approval_sha256: m.approval_sha256 });
  write('central-release-result.json', m.central_release);
  write('approval.json', approval);
  const intent = { scope, plan_sha256: m.plan_sha256, at: '2024-01-01T01:02:02Z' };
  write('disconnect-intent.json', intent);
  write('../disconnect-intent.json', { ...intent, task_id: record.epoch_id });
  write('disconnect-result.json', wire);
  write('disconnect-wire/result.json', wire);
  write('disconnect-wire/host-response.raw', raw);
  const done = {
    protocol: 'cloud-test-adb-fence-transaction/v1', status: 'observed', plan_sha256: m.plan_sha256,
    original_execution_stopped: false, before_sha256: write('before.json', before), after_sha256: write('after.json', after),
    wire_sha256: m.wire_sha256, hardware_serial_sha256: m.hardware_serial_sha256, boot_id_sha256: m.boot_id_sha256
  };
  m.completion_sha256 = write('complete.json', done);
  return { after, approval, done, intent, raw, write };
}

test('an existing-route reference verifies the journal and one exact wire acknowledgement', t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-fence-consumer-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const f = fixture(home), { spec, record, facts } = f;
  assert.equal(validateEpochRecord(record, spec, { home }), record);
  const path = join(home, '.local/share/zenithjoy/device-epoch-fences', serial, record.epoch_id + '.json');
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  mkdirSync(join(record.new_route.policy_path, '..'), { recursive: true, mode: 0o700 });
  const writeRecord = () => writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
  writeRecord();
  writeFileSync(record.new_route.policy_path, JSON.stringify(spec.policy), { mode: 0o600 });
  const freeze = () => freezeFenceReference({ scope: spec, epochId: record.epoch_id, home });
  assert.throws(freeze, { code: 'ENOENT' });
  const { after, approval, done, intent, raw, write } = makeJournal(f);
  writeRecord();
  assert.equal(freeze().path, path);
  assert.deepEqual(readCloudExistingEpochCompletion(record, { home }), {
    completion_sha256: record.cloud_migration.completion_sha256,
    manifest_sha256: facts.frozen.release.manifest_sha256
  });
  const wrong = structuredClone(record);
  wrong.resource.adb_serial = serial;
  assert.throws(() => validateEpochRecord(wrong, spec, { home }), /EPOCH_CLOUD_SCOPE|EPOCH_DEVICE_IDENTITY/);
  write('../disconnect-intent.json', { ...intent, task_id: id('f') });
  assert.throws(freeze, /EPOCH_CLOUD_WIRE/);
  write('../disconnect-intent.json', { ...intent, task_id: record.epoch_id });
  write('approval.json', { ...approval, approved_by: 'unexpected operator' });
  assert.throws(freeze, /EPOCH_CLOUD_APPROVAL/);
  write('approval.json', approval);
  write('disconnect-wire/host-response.raw', Buffer.from('FAIL'));
  assert.throws(freeze, /EPOCH_CLOUD_WIRE/);
  write('disconnect-wire/host-response.raw', raw);
  const changed = { ...after, boot_id_sha256: digest('later boot') };
  done.after_sha256 = write('after.json', changed);
  record.cloud_migration.completion_sha256 = write('complete.json', done);
  writeRecord();
  assert.throws(freeze, /EPOCH_CLOUD_JOURNAL/, 'updated hashes cannot hide conflicting boot evidence');
  done.after_sha256 = write('after.json', after);
  record.cloud_migration.completion_sha256 = write('complete.json', done);
  writeRecord();
  assert.equal(freeze().path, path);
  write('unknown.json', { retry_allowed: false });
  assert.throws(freeze, /EPOCH_CLOUD_JOURNAL/);
});

function reviewedSuccessor(f = fixture().facts, originalRef) {
  const { frozen, record } = f;
  const spec = frozen.discovery_phone_scope;
  const release = { id: id('e'), target: 'mmv', environment: 'staging:' + 'b'.repeat(40), payload: {
    components: [{ kind: 'repo', repo: 'perfectuser21/zenithjoy-workspace', revision: 'b'.repeat(40) }],
    verification: { status: 'verified', ci_status: 'verified' },
  } };
  release.manifest_sha256 = digest({ environment: release.environment, target: release.target, payload: release.payload });
  const observation = { id: id('f'), release_id: release.id, payload: {
    environment: release.environment, target: 'mmv', components: release.payload.components,
  } };
  observation.payload_sha256 = digest(observation.payload);
  const gate = { release_id: release.id, current_observation_id: observation.id, deployed: true,
    actual_matches: true, current_status: 'deployed', gaps: [], verification: { status: 'verified', ci_status: 'verified' } };
  const original = { release_id: frozen.release.id, observation_id: frozen.deployment.observation_id,
    manifest_sha256: frozen.release.manifest_sha256 };
  const candidate = { commit: 'b'.repeat(40), files: { 'code.mjs': digest('successor-runtime') } };
  f.source = candidate;
  f.recordSha256 = originalRef?.sha256 ?? digest(record);
  spec.source_commit = candidate.commit;
  spec.run_id = frozen.public_domain.run_id;
  f.task.result.common_runner.mode = 'formal';
  spec.policy_binding.epoch_fence = originalRef ?? { protocol: 'device-epoch-fence-reference/v1', epoch_id: record.epoch_id, sha256: f.recordSha256 };
  const receipt = { protocol: 'cloud-101-epoch-source-compatibility/v1', business_run_id: frozen.public_domain.run_id,
    original_record_sha256: f.recordSha256, original_runtime_source: record.runtime_source,
    original, candidate_runtime_source: candidate, candidate_manifest_sha256: digest(candidate.files),
    candidate_release_manifest_sha256: release.manifest_sha256,
    release_id: release.id, observation_id: observation.id,
    serial: spec.serial, instance_id: spec.policy.instance_id, policy_sha256: spec.policy_binding.policy_sha256,
    changes: [{ path: 'code.mjs', before_sha256: record.runtime_source.files['code.mjs'], after_sha256: candidate.files['code.mjs'] }],
    evidence_refs: ['artifact://source-review'], actor: 'independent-reviewer' };
  Object.assign(frozen.deployment, { source_commit: candidate.commit, environment: release.environment, release_id: release.id,
    observation_id: observation.id });
  frozen.release = release;
  frozen.epoch_source_compatibility = { review_task_id: id('8'), receipt, receipt_sha256: digest(receipt) };
  frozen.files = { 'runtime/code.mjs': candidate.files['code.mjs'] };
  f.binding.payload.runtime_snapshot_sha256 = digest(candidate.files);
  f.binding.release_id = release.id;
  f.binding.observation_id = observation.id;
  f.compatibilityReview = { id: id('8'), status: 'completed', task_type: 'research', parent_task_id: id('9'), payload: {
    work_kind: 'epoch_source_compatibility_review', reviewer: receipt.actor, business_run_id: receipt.business_run_id,
    candidate_source_commit: candidate.commit, original_record_sha256: f.recordSha256, development_task_id: id('9'),
  }, result: { actor: receipt.actor, audit_evidence: { path: receipt.evidence_refs[0], sha256: digest('review'), verdict: 'pass' },
    epoch_source_compatibility: structuredClone(receipt) } };
  f.compatibilityDevelopment = { id: id('9'), task_type: 'dev', result: { ship_candidate: {
    schema_version: 1, stage: 'candidate', task_id: id('9'), repo: 'perfectuser21/zenithjoy-workspace',
    head_sha: candidate.commit, actor: 'developer',
  } } };
  f.compatibilityRelease = { release, observation, gate };
  return f;
}

test('reviewed formal Code 101 successor uses the immutable earlier physical epoch and new release', () => {
  const f = reviewedSuccessor();
  const originalBytes = JSON.stringify(f.record);
  const proof = verifyEpochFacts(f);
  assert.equal(proof.authorized, true);
  assert.equal(proof.source_commit, f.frozen.deployment.source_commit);
  assert.notEqual(proof.source_commit, f.record.runtime_source.commit);
  assert.equal(JSON.stringify(f.record), originalBytes);
  assert.equal(proof.original_execution_stopped, false);
});

test('reviewed successor rejects an altered origin, new artifact, run, or device', () => {
  for (const change of [
    f => { f.compatibilityRelease.gate.current_observation_id = id('0'); },
    f => { f.compatibilityRelease.observation.payload_sha256 = digest('wrong observation'); },
    f => { f.cloudCompletion.manifest_sha256 = f.frozen.release.manifest_sha256; },
    f => { f.compatibilityReview.payload.business_run_id = id('0'); },
    f => { f.compatibilityReview.status = 'in_progress'; },
    f => { f.compatibilityDevelopment.result.ship_candidate.actor = f.compatibilityReview.result.actor; },
    f => { f.task.result.common_runner.mode = 'exploration'; },
    f => { f.originalTask.result = { execution_stopped: true }; },
    f => { f.cloudBootIdSha256 = digest('different boot'); },
  ]) {
    const f = reviewedSuccessor();
    change(f);
    assert.throws(() => verifyEpochFacts(f), /EPOCH_/);
  }
});

function brainSnapshot(facts) {
  const { compatibilityReview, compatibilityRelease, compatibilityDevelopment, originalTask, task, binding, links, taskRun, central } = facts;
  const { release, observation, gate } = compatibilityRelease;
  const review = structuredClone(compatibilityReview);
  review.result.epoch_source_compatibility_sha256 = digest(review.result.epoch_source_compatibility);
  delete review.result.epoch_source_compatibility;
  return { protocol: 'cloud-101-admission-snapshot/v1', task, binding, links, taskRun, central, originalTask, compatibilityDevelopment, compatibilityReview: review,
    compatibilityRelease: { release_id: release.id, observation_id: observation.id,
      environment: release.environment, target: release.target, source_commit: facts.frozen.deployment.source_commit,
      manifest_sha256: release.manifest_sha256, observation_payload_sha256: observation.payload_sha256,
      release_components_sha256: digest(release.payload.components), observation_components_sha256: digest(observation.payload.components),
      gate: structuredClone(gate) } };
}

test('formal successor reads one coherent Brain projection per phase and preserves local epoch evidence', async () => {
  const facts = reviewedSuccessor();
  const { frozen, record } = facts;
  const snapshot = brainSnapshot(facts);
  const readBudget = { deadlineMs: Date.now() + 3000, maxAttempts: 1 };
  const seen = [];
  const read = async (path, budget) => {
    seen.push(path);
    const endpoint = new URL(path, 'http://localhost');
    assert.equal(endpoint.pathname, '/api/brain/cloud-101-admission/' + frozen.public_domain.run_id);
    assert.deepEqual(Object.fromEntries(endpoint.searchParams), {
      task_id: facts.task.id, binding_id: facts.binding.id,
      release_id: frozen.release.id, observation_id: frozen.deployment.observation_id,
      device_name: frozen.discovery_phone_scope.serial, profile: frozen.discovery_phone_scope.profile,
      profile_sha256: frozen.public_domain.profile_sha256, source_commit: frozen.deployment.source_commit,
      original_task_id: record.original.task_id, review_task_id: facts.compatibilityReview.id,
    });
    assert.equal(budget, readBudget);
    return {...snapshot, record: { status: 'foreign' }, frozen: {} };
  };
  const first = await readCloud101BusinessFacts({ frozen, record, readBudget, read });
  assert.equal(seen.length, 1);
  assert.equal(Object.hasOwn(first, 'record'), false);
  assert.equal(Object.hasOwn(first, 'frozen'), false);
  assert.equal(verifyEpochFacts({...facts,...first}).authorized, true);
  snapshot.compatibilityRelease.gate.deployed = false;
  await assert.rejects(readCloud101BusinessFacts({ frozen, record, readBudget, read }), /EPOCH_SOURCE_COMPATIBILITY/);
  assert.equal(seen.length, 2);
});

test('formal successor refuses unavailable snapshots, changed reviews and mismatched release components', async () => {
  const facts = reviewedSuccessor();
  const { frozen, record } = facts;
  let attempted = 0;
  await assert.rejects(readCloud101BusinessFacts({ frozen, record, read: async () => {
    attempted++;
    throw Error('snapshot unavailable');
  }}), /snapshot unavailable/);
  assert.equal(attempted, 1);
  for (const corrupt of [
    snapshot => { snapshot.compatibilityReview.result.epoch_source_compatibility_sha256 = digest('new review'); },
    snapshot => { snapshot.compatibilityRelease.observation_components_sha256 = digest('other observation'); },
    snapshot => { snapshot.compatibilityRelease.manifest_sha256 = digest('swapped manifest'); },
  ]) {
    const snapshot = brainSnapshot(facts);
    corrupt(snapshot);
    await assert.rejects(readCloud101BusinessFacts({ frozen, record, read: async () => snapshot }), /EPOCH_SOURCE_COMPATIBILITY/);
  }
});

test('the reviewed successor selects and reopens the original on-disk epoch through the formal route boundary', t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-successor-route-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const user = userInfo();
  const homeMock = t.mock.method(os, 'userInfo', () => ({ ...user, homedir: home }));
  syncBuiltinESMExports();
  t.after(() => { homeMock.mock.restore(); syncBuiltinESMExports(); });

  const rig = fixture(home), { record, spec } = rig;
  const work = join(home, 'candidate');
  const registryPath = 'config/adb-host-instances.json';
  const registry = JSON.stringify({ schema_version: 1, instances: [
    { instance_id: instance, kind: 'managed', policy_path: record.new_route.policy_path, policy: spec.policy },
  ] });
  const registryHash = digest(registry);
  mkdirSync(join(work, 'config'), { recursive: true, mode: 0o700 });
  writeFileSync(join(work, registryPath), registry, { mode: 0o600 });
  mkdirSync(join(record.new_route.policy_path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(record.new_route.policy_path, JSON.stringify(spec.policy), { mode: 0o600 });
  makeJournal(rig);
  const path = join(home, '.local/share/zenithjoy/device-epoch-fences', serial, record.epoch_id + '.json');
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const immutable = Buffer.from(JSON.stringify(record));
  writeFileSync(path, immutable, { mode: 0o600 });
  const originalRef = freezeFenceReference({ scope: spec, epochId: record.epoch_id });
  rig.facts.cloudCompletion = readCloudExistingEpochCompletion(record);
  const f = reviewedSuccessor(rig.facts, originalRef);
  const { policy_binding, ...registered } = spec;
  assert.equal(policy_binding.epoch_fence.sha256, originalRef.sha256);
  const opts = { root: work, manifest: { ...f.frozen.deployment, files: [
    { path: 'services/phone-adb-controller/' + registryPath, deployed_path: registryPath, content_sha256: registryHash },
  ] }, scope: registered, instanceId: instance, epochId: record.epoch_id, workflowKey: 'douyin_video_discovery' };
  assert.throws(() => selectPublicPreflightScope(opts), /EPOCH_RECORD_SCOPE/);
  const fixed = selectPublicPreflightScope({ ...opts, epochSourceCompatibility: f.frozen.epoch_source_compatibility });
  assert.deepEqual(fixed.policy_binding.epoch_fence, originalRef);
  assert.equal(fixed.source_commit, f.source.commit);
  f.frozen.discovery_phone_scope = fixed;
  const route = freezePublicPreflightRoute({ root: work, files: { [registryPath]: registryHash },
    scope: epochCompatibilityRecordScope(f.frozen) });
  assert.deepEqual(route, fixed.policy_binding);
  assert.equal(verifyEpochFacts(f).authorized, true);
  assert.deepEqual(readFileSync(path), immutable);

  const stepsPath = 'steps.json';
  const registryFile = join(work, 'registry.tsv');
  writeFileSync(registryFile, `profile\tserial\tmodel\twidth\theight\tenabled\n${profile}\t${serial}\tFixture\t720\t1280\ttrue\n`, { mode: 0o600 });
  writeFileSync(join(work, stepsPath), '{}', { mode: 0o600 });
  const env = { P: profile, SERIAL: serial, WFR_TAG: 'reviewed-fixture', LEADGEN_LINE: 'yuesheng', LEADGEN_LIMIT: '1',
    LEADGEN_MMV_DEVICE_RUNTIME: '1', DOUYIN_PHONE_REGISTRY: registryFile, DOUYIN_ADB_PORT: '5042', ADB_SERVER_SOCKET: newEndpoint };
  const { public_domain: business, ...template } = structuredClone(f.frozen);
  const { run_binding: runBinding } = business;
  template.preflight_profile = freezePreflightProfile({ env });
  template.public_preflight_route = route;
  template.workflow_version.payload.workflow_id = runBinding.workflow_id;
  const step = runBinding.activities.preflight;
  template.activities = [{ reference: { slot_key: 'preflight', reference_id: step.reference_id, activity_id: step.activity_id },
    version: { id: step.activity_definition_version_id } }];
  const profileFiles = { [registryPath]: registryHash, [stepsPath]: digest('{}') };
  template.epoch_source_compatibility.receipt.candidate_manifest_sha256 = digest(profileFiles);
  template.epoch_source_compatibility.receipt_sha256 = digest(template.epoch_source_compatibility.receipt);
  const candidateProfile = { cwd: work, files: profileFiles, contract: { activities: [{ key: 'preflight' }] },
    metadata: { preflight: { activity_id: step.activity_id, executor_kind: 'code', runtime_snapshot_sha256: digest(profileFiles) } },
    domain_adapter: { budget: { max_duration_s: 90 }, config: { workflow_key: 'douyin_video_discovery', execution_mode: 'code',
      env, resources: { machine: 'us-mac-m4', profile, serial, account: expectedAccount, line: 'yuesheng' },
      company: record.resource.company, step_spec: stepsPath, snapshot: template } } };
  const identity = { ...business, mode: 'formal', profile_sha256: digest(candidateProfile) };
  const prepare = (runId, name) => preparePublicDomainSnapshot({
    identity: { ...identity, run_id: runId }, profile: candidateProfile, runDirectory: join(home, name),
    deadline_ms: Date.now() + 90000, cleanup_deadline_ms: Date.now() + 100000,
  });
  assert.throws(() => prepare(id('0'), 'never-materialized'), /EPOCH_SOURCE_COMPATIBILITY/);
  const prepared = prepare(business.run_id, 'successor-run');
  assert.deepEqual(prepared.snapshot.epoch_source_compatibility, template.epoch_source_compatibility);
  assert.deepEqual(prepared.snapshot.discovery_phone_scope.policy_binding.epoch_fence, originalRef);
  assert.deepEqual(readFileSync(path), immutable);

  assert.throws(() => selectPublicPreflightScope({ ...opts, workflowKey: 'douyin_video_processing',
    epochSourceCompatibility: f.frozen.epoch_source_compatibility }), /PUBLIC_PREFLIGHT_ROUTE_SOURCE/);
});
