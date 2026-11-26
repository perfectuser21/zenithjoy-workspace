import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest } from '../device-epoch-fence-reference.mjs';
import { runYueshengMigration } from '../device-epoch-fence-yuesheng-migration.mjs';
import { now, at, oldEndpoint, newEndpoint, physicalSerial, transportSerial, sha, releaseId, observationId, taskId, fixture } from './fixtures/yuesheng-migration-readback.mjs';

function setup(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'yuesheng-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const journal = join(root, 'yuesheng-5044-to-5045');
  const evidence = fixture();
  const plan = {
    protocol: 'yuesheng-adb-migration-plan/v1', task_id: taskId, pending_action_id: '44444444-4444-4444-8444-444444444444',
    claim: { claimed_by: evidence.task.claimed_by, claimed_at: evidence.task.claimed_at },
    lease: evidence.current_lock,
    source_commit: sha, release_id: releaseId, observation_id: observationId,
    physical_serial: physicalSerial, transport_serial: transportSerial,
    old_endpoint: oldEndpoint, new_endpoint: newEndpoint, new_instance_id: 'mmv-yuesheng-direct',
  };
  const approval = { protocol: 'yuesheng-adb-migration-approval/v1', approved_by: 'operator', approved_at: at(-70000),
    plan_sha256: digest(plan), actions: ['disconnect_old', 'connect_new'] };
  const facts = { task: { ...evidence.task, result: { yuesheng_adb_migration_approval: approval } },
    deviceLocks: { success: true, locks: [evidence.current_lock] },
    pendingAction: { id: plan.pending_action_id, status: 'approved', action_type: 'owner_decision', source: 'yuesheng_adb_migration',
      params: { protocol: 'yuesheng-adb-migration-request/v1', task_id: taskId, device_name: physicalSerial,
        lease_version: plan.lease.lease_version, source_commit: sha }, execution_result: approval } };
  const operations = [];
  const read = name => JSON.parse(readFileSync(join(journal, `${name}.json`), 'utf8'));
  let currentTime = now - 30_000;
  const io = {
    now: () => currentTime,
    withDeviceGuard: async (serial, callback) => {
      assert.equal(serial, physicalSerial);
      return callback({ assertHeld: async () => {} });
    },
    readAuthority: async () => structuredClone(facts),
    readCandidate: async () => structuredClone(evidence.candidate),
    observe: async position => {
      if (position === 'after') currentTime = now;
      return structuredClone(position === 'between'
        ? { observed_at: new Date(currentTime).toISOString(), old_route: evidence.after.old_route, new_route: evidence.before.new_route }
        : evidence[position]);
    },
    operate: async ({ operation, scope, assertAuthority }) => {
      const intent = read(`${operation}-intent`);
      assert.deepEqual(intent.scope, scope);
      assert.equal(intent.plan_sha256, digest(plan));
      await assertAuthority();
      operations.push(operation);
      const response = `${operation === 'disconnect' ? 'disconnected ' : 'connected to '}${transportSerial}`;
      return { protocol: 'device-epoch-fence-host-operation/v1', operation, scope, wire_complete: true,
        peer_eof: true, socket_closed: true, pending: 0, write_attempted: true, write_acknowledged: true,
        action_confirmed: true, error_code: null,
        action_error_code: null, raw_sha256: digest(response), response };
    },
  };
  return { root, journal, plan, facts, evidence, operations, io, read, run: () => runYueshengMigration({ plan, journalRoot: root, io }) };
}

test('持久化前置证据、每步 intent 和实质回执，再保存完成核验', async t => {
  const x = setup(t);
  const result = await x.run();
  assert.deepEqual(x.operations, ['disconnect', 'connect']);
  assert.equal(x.read('before').physical_readback['ro.serialno'].value, physicalSerial);
  assert.equal(x.read('between').old_route.devices.length, 0);
  assert.equal(x.read('between').new_route.devices.length, 0);
  assert.equal(x.read('disconnect-result').scope.endpoint, oldEndpoint);
  assert.equal(x.read('connect-result').scope.endpoint, newEndpoint);
  assert.deepEqual(result, x.read('complete'));
  assert.equal(result.observation.authorization, 'none');
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_REPLAY' });
  assert.deepEqual(x.operations, ['disconnect', 'connect']);
});

test('旧路由在断连操作后重现，禁止接触新路由', async t => {
  const x = setup(t);
  const observe = x.io.observe;
  x.io.observe = async position => {
    const observation = await observe(position);
    if (position === 'between') observation.old_route = structuredClone(x.evidence.before.old_route);
    return observation;
  };
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_OLD_ROUTE_AFTER' });
  assert.deepEqual(x.operations, ['disconnect']);
  assert.equal(x.read('unknown').retry_allowed, false);
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_REPLAY' });
  assert.deepEqual(x.operations, ['disconnect']);
});

test('断连已发出但未获回执，重启不重放该动作', async t => {
  const x = setup(t);
  x.io.operate = async ({ operation }) => {
    x.read(`${operation}-intent`);
    x.operations.push(operation);
    throw Error('lost wire acknowledgement');
  };
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_OPERATION_UNKNOWN' });
  assert.deepEqual(x.operations, ['disconnect']);
  assert.equal(x.read('unknown').operation, 'disconnect');
  assert.ok(!readdirSync(x.journal).includes('disconnect-result.json'));
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_REPLAY' });
  assert.deepEqual(x.operations, ['disconnect']);
});

test('接入阶段授权或 CAS 租约变化，不接入也不回滚', async t => {
  for (const type of ['cancelled', 'approval_drift', 'lease']) {
    const x = setup(t);
    const operate = x.io.operate;
    x.io.operate = async input => {
      const result = await operate(input);
      if (type === 'cancelled') x.facts.pendingAction.status = 'cancelled';
      else if (type === 'approval_drift') x.facts.pendingAction.execution_result.approved_by = 'other-operator';
      else x.facts.deviceLocks.locks = [{ ...x.plan.lease, lease_version: '55042632' }];
      return result;
    };
    const code = type === 'lease' ? 'AUTHORITY_LEASE' : 'AUTHORITY_APPROVAL';
    await assert.rejects(x.run(), { code: `YUESHENG_MIGRATION_${code}` });
    assert.deepEqual(x.operations, ['disconnect']);
    await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_REPLAY' });
  }
});

test('只有观察材料或有别的批准，不能开始设备动作', async t => {
  for (const mutate of [
    facts => { facts.task.result.yuesheng_adb_migration_approval.plan_sha256 = '0'.repeat(64); },
    facts => { facts.pendingAction.source = 'owner_decision_guard'; },
    facts => { facts.pendingAction.params.lease_version = '99'; },
    facts => { facts.pendingAction.params.source_commit = '0'.repeat(40); },
  ]) {
    const x = setup(t);
    mutate(x.facts);
    await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_AUTHORITY_APPROVAL' });
    assert.deepEqual(x.operations, []);
    assert.deepEqual(readdirSync(x.root), []);
  }
});


test('没有终态文件的进程中断保留 intent，重启和替换租约均不能续写', async t => {
  const x = setup(t);
  const module = new URL('../device-epoch-fence-yuesheng-migration.mjs', import.meta.url).href;
  const input = JSON.stringify({ plan: x.plan, facts: x.facts, evidence: x.evidence, root: x.root });
  const code = `import { runYueshengMigration } from ${JSON.stringify(module)};
    const { plan, facts, evidence, root } = JSON.parse(process.argv[1]);
    await runYueshengMigration({ plan, journalRoot: root, io: {
      now: () => ${now - 30_000}, withDeviceGuard: (_, callback) => callback({ assertHeld: async () => {} }),
      readAuthority: async () => facts, readCandidate: async () => evidence.candidate,
      observe: async () => evidence.before, operate: async () => process.exit(91),
    } });`;
  const interrupted = spawnSync(process.execPath, ['--input-type=module', '--eval', code, input], { encoding: 'utf8' });
  assert.equal(interrupted.status, 91, interrupted.stderr);
  assert.deepEqual(readdirSync(x.journal).sort(), ['before.json', 'disconnect-intent.json', 'plan.json']);
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_REPLAY' });
  x.plan.lease.lease_version = '55042632';
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_REPLAY' });
  assert.deepEqual(x.operations, []);
});

test('拒绝使用早于接入动作的候选观察', async t => {
  const x = setup(t);
  const observe = x.io.observe;
  x.io.observe = async position => {
    const result = await observe(position);
    if (position === 'after') {
      result.observed_at = at(-31000);
      result.physical_readback.observed_at = result.observed_at;
    }
    return result;
  };
  await assert.rejects(x.run(), { code: 'YUESHENG_MIGRATION_OBSERVATION_WINDOW' });
  assert.deepEqual(x.operations, ['disconnect', 'connect']);
  assert.ok(!readdirSync(x.journal).includes('complete.json'));
});
