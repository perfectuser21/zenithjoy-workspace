import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { digest, readCloudExistingEpochCompletion } from '../device-epoch-fence-reference.mjs';
import { createCloudEpochIssuer } from '../device-epoch-fence-cloud-execution.mjs';
import { save } from '../device-epoch-fence-files.mjs';
import { createCloudFencePlan, applyCloudFencePlan, cloudFenceOperator, cloudFenceRoute } from '../device-epoch-fence-cloud-migration.mjs';

const taskId = 'cfa3bac3-3101-47ee-a979-7034fad0375b';
const original = { task_id: '0874e3fc-b7c2-46a6-b97e-cdc1264a693c', run_id: '867d15ae-69d7-455b-b8db-4f0299bce291' };
const actionId = 'cb405d85-eb41-4f85-933a-661030350ee0';
const releaseId = '7e84d95a-8dc1-4558-8bee-51b12432c71e';
const observationId = 'fbdaa8c1-b7ae-4079-a971-2c025753f2f1';
const source = 'a'.repeat(40);
const pin = (character) => character.repeat(64);
const baseTime = Date.now() - 5_000;
const at = (offset) => new Date(baseTime + offset).toISOString();
const route = cloudFenceRoute;

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'zj-cloud-fence-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const task = { id: taskId, status: 'in_progress', claimed_by: 'maintainer', claimed_at: at(0),
    payload: { work_kind: 'coding_review', headed_manual: true, scope: ['switch_mmv_cloud_101_to_5042'], source_task_id: original.task_id, source_run_id: original.run_id }, result: {} };
  const lease = { device_name: route.serial, locked_by: taskId, locked_at: at(500), expires_at: at(120_000),
    lease_version: '12', expired: false };
  const operatorTask = { id: cloudFenceOperator.task_id, result: { phone_101_single_device_switch: {
    operator_authorized: true, authorized_scope: cloudFenceOperator.choice, actor: 'interactive-dev-skill',
    old_route: 'unauthorized', new_route: 'device', device_mutated: false, business_started: false, recorded_at: at(0),
  } } };
  const candidate = { manifest: { target: 'mmv', source_repo: 'perfectuser21/zenithjoy-workspace',
    source_commit: source, release_id: releaseId, observation_id: observationId, environment: 'staging:' + source,
    manifest_sha256: pin('a') },
    gate: { deployed: true, actual_matches: true, current_observation_id: observationId, release_id: releaseId },
    resource: { serial: route.serial, profile: route.profile, expected_account: '77980009922', line: 'yuesheng',
      company: { company_id: taskId, tenant_id: actionId, version: 1, policy_id: 'test-policy' } } };
  const before = {
    provider_binding_sha256: pin('b'), hardware_serial_sha256: pin('c'), boot_id_sha256: pin('d'),
    old_daemon_sha256: pin('e'), new_daemon_sha256: pin('f'), consumer_readback_sha256: pin('1'),
    noninterference_sha256: pin('2'), old_device: { serial: route.serial, state: 'unauthorized', properties: 'transport_id:35' },
    new_device: { serial: route.serial, state: 'device', properties: 'transport_id:9' },
  };
  const after = { ...before, old_device: null, noninterference_sha256: pin('3') };
  const trace = [];
  let tick = 5_000;
  const io = {
    now: () => baseTime + tick,
    readAuthority: async () => ({ task, originalTask: { id: original.task_id, status: 'blocked' }, operatorTask, deviceLocks: { success: true, locks: [lease] } }),
    readCandidate: async () => candidate,
    withDeviceGuard: async (serial, run) => {
      assert.equal(serial, route.serial);
      trace.push('guard');
      return run({ assertHeld: async () => {} });
    },
    observe: async (phase) => {
      trace.push(phase);
      return { ...(phase === 'after' ? after : before), observed_at: at(tick) };
    },
    disconnect: async ({ scope, assertAuthority, journal }) => {
      await assertAuthority();
      trace.push('disconnect');
      tick += 1_000;
      const response = 'disconnected ' + route.serial + '\n';
      const directory = join(journal, 'disconnect-wire');
      mkdirSync(directory, { mode: 0o700 });
      const rawSha = save(join(directory, 'host-response.raw'),
        Buffer.from('OKAY' + Buffer.byteLength(response).toString(16).padStart(4, '0') + response));
      const receipt = { protocol: 'device-epoch-fence-host-operation/v1', operation: 'disconnect', scope,
        wire_complete: true, peer_eof: true, socket_closed: true, pending: 0, write_attempted: true,
        write_acknowledged: true, action_confirmed: true, error_code: null, action_error_code: null,
        retry_allowed: false, original_execution_stopped: false, raw_sha256: rawSha, response };
      save(join(directory, 'result.json'), receipt);
      return receipt;
    },
  };
  const input = { taskId, sourceCommit: source };
  const approve = (plan) => {
    const approval = { protocol: 'cloud-phone-101-route-fence-approval/v1', plan_sha256: digest(plan),
      approved_at: at(tick), approved_by: 'authenticated-operator', approval_ref: 'task:' + cloudFenceOperator.task_id + ':phone_101_single_device_switch',
      actions: ['disconnect_old_serial'] };
    task.result.cloud_phone_101_route_fence_approval = approval;
  };
  return { root, input, io, before, after, lease, trace, task, approve, candidate };
}

test('one bound old disconnect, durable independent readback and no replay', async (t) => {
  const f = fixture(t);
  const { plan, plan_sha256 } = await createCloudFencePlan(f.input, f.io);
  assert.equal(plan_sha256, digest(plan));
  assert.deepEqual(f.trace, ['before']);
  f.approve(plan);
  const result = await applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io });
  assert.equal(result.status, 'observed');
  assert.equal(result.original_execution_stopped, false);
  assert.deepEqual(f.trace, ['before', 'guard', 'before', 'disconnect', 'after']);
  assert.equal(result.wire_sha256, digest(readFileSync(join(f.root, taskId, 'disconnect-wire', 'host-response.raw'))));
  const saved = JSON.parse(readFileSync(join(f.root, taskId, 'complete.json')));
  assert.deepEqual(saved, result);
  await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_REPLAY/);
  assert.equal(f.trace.filter(x => x === 'disconnect').length, 1);
});

test('invalid approval and lease drift never reach the transport', async (t) => {
  const f = fixture(t);
  const { plan } = await createCloudFencePlan(f.input, f.io);
  await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_APPROVAL/);
  f.approve(plan);
  f.lease.lease_version = '13';
  await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_(LEASE|AUTHORITY_DRIFT)/);
  assert.equal(f.trace.includes('disconnect'), false);
});

test('a changed target before the write cannot consume the approved operation', async (t) => {
  const f = fixture(t);
  const { plan } = await createCloudFencePlan(f.input, f.io);
  f.approve(plan);
  f.before.old_device.properties = 'transport_id:36';
  await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_OBSERVATION_DRIFT/);
  assert.equal(f.trace.includes('disconnect'), false);
  assert.equal(existsSync(join(f.root, 'disconnect-intent.json')), false);
});

test('candidate drift at the write boundary blocks disconnect and preserves the global intent slot', async (t) => {
  const f = fixture(t);
  const { plan } = await createCloudFencePlan(f.input, f.io);
  f.approve(plan);
  const observe = f.io.observe;
  f.io.observe = async phase => {
    const facts = await observe(phase);
    f.candidate.gate.current_observation_id = 'cb405d85-eb41-4f85-933a-661030350ee0';
    return facts;
  };
  await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_CANDIDATE/);
  assert.deepEqual(f.trace, ['before', 'guard', 'before']);
  assert.equal(existsSync(join(f.root, 'disconnect-intent.json')), false);
});

for (const failure of ['wire lost', 'old route reappeared', 'hardware identity changed']) {
  test(`${failure} retains exclusive durable intent and no second transport operation`, async (t) => {
    const f = fixture(t);
    const { plan } = await createCloudFencePlan(f.input, f.io);
    f.approve(plan);
    const send = f.io.disconnect;
    if (failure === 'wire lost') f.io.disconnect = async (input) => ({ ...await send(input), wire_complete: false });
    if (failure === 'old route reappeared') f.after.old_device = f.before.old_device;
    if (failure === 'hardware identity changed') f.after.hardware_serial_sha256 = pin('9');
    await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_/);
    const unknown = JSON.parse(readFileSync(join(f.root, taskId, 'unknown.json')));
    assert.equal(unknown.retry_allowed, false);
    assert.equal(existsSync(join(f.root, taskId, 'complete.json')), false);
    await assert.rejects(() => applyCloudFencePlan({ plan, journalRoot: f.root, io: f.io }), /CLOUD_FENCE_REPLAY/);
    assert.equal(f.trace.filter(value => value === 'disconnect').length, 1);
  });
}

test('exact disconnect journal and confirmed central CAS issue a consumer-verifiable epoch', async (t) => {
  const f = fixture(t);
  const home = f.root, base = join(home, '.local/share/zenithjoy');
  const journalRoot = join(base, 'device-epoch-migrations', route.serial, 'cloud-test-5041-to-5042');
  mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
  const policyPath = join(home, '.config/zenithjoy/adb-instances', route.instance_id + '.json');
  mkdirSync(join(home, '.config/zenithjoy/adb-instances'), { recursive: true, mode: 0o700 });
  const policy = { schema_version: 2, instance_id: route.instance_id, endpoint: route.new_endpoint, host_id: 'mmv', transport: 'tcp' };
  const daemon = { uid: process.getuid(), start_identity: 'fixture-start', command: 'fixture-adb',
    executable: '/fixture/adb', executable_sha256: pin('1') };
  const daemons = {
    old: { ...daemon, pid: 1234, endpoint: route.old_endpoint,
      policy_path: join(home, '.config/zenithjoy/adb-service.json'), policy_sha256: pin('2') },
    next: { ...daemon, pid: 5678, endpoint: route.new_endpoint, instance_id: route.instance_id,
      policy_path: policyPath, policy_sha256: save(policyPath, policy) },
  };
  f.before.old_daemon_sha256 = f.after.old_daemon_sha256 = digest(daemons.old);
  f.before.new_daemon_sha256 = f.after.new_daemon_sha256 = digest(daemons.next);
  const free = { device_name: route.serial, locked_by: null, locked_at: null, expires_at: null,
    lease_version: '13', expired: false };
  let current = f.lease;
  f.io.issueAdmission = createCloudEpochIssuer({
    home, daemons, host: { target: 'mmv', ...f.candidate.resource },
    instance: { instance_id: route.instance_id, policy },
    source: () => ({ commit: source, files: {} }),
    ensureRecords: path => mkdirSync(path, { recursive: true, mode: 0o700 }),
    centralRead: async path => path.endsWith('/device-locks') ? { success: true, locks: [current] } : f.task,
    async centralPost(path, body) {
      assert.equal(path, '/api/brain/device-locks/release');
      assert.deepEqual(body, { device_name: route.serial, locked_by: taskId, expected_lease_version: '12' });
      f.trace.push('release');
      current = free;
      return { status: 200, body: { success: true, released: free } };
    },
    async assertPostRelease({ proof, assertHeld }) {
      await assertHeld();
      assert.equal(proof.current.lease_version, '13');
      f.trace.push('post-release');
    },
  });
  const { plan } = await createCloudFencePlan(f.input, f.io);
  f.approve(plan);
  const result = await applyCloudFencePlan({ plan, journalRoot, io: f.io });
  assert.deepEqual(f.trace, ['before', 'guard', 'before', 'disconnect', 'after', 'release', 'post-release']);
  const record = JSON.parse(readFileSync(result.epoch_reference.path));
  assert.equal(record.original_execution_stopped, false);
  assert.equal(readCloudExistingEpochCompletion(record, { home }).manifest_sha256, plan.manifest_sha256);
  assert.equal(result.epoch_reference.sha256, digest(readFileSync(result.epoch_reference.path)));
});
