import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { digest } from '../runtime-definition.mjs';
import { verifyEpochFacts } from '../device-epoch-fence-admission.mjs';
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
