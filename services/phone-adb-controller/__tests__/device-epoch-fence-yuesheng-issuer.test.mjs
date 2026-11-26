import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { save } from '../device-epoch-fence-files.mjs';
import { digest, readYueshengEpochCompletion } from '../device-epoch-fence-reference.mjs';
import { createYueshengEpochIssuer } from '../device-epoch-fence-yuesheng-issuer.mjs';
import { yueshengMaintenanceTask } from '../device-epoch-fence-yuesheng-host-reads.mjs';
import { verifyYueshengMigrationReadback, yueshengMigrationRoute } from '../device-epoch-fence-yuesheng-readback.mjs';
import { at, fixture, now, sha, releaseId, observationId } from './fixtures/yuesheng-migration-readback.mjs';

function setup(t, { releaseUnknown = false, sharedMode = 0o700, sharedSymlink = false } = {}) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'yuesheng-issuer-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const base = join(home, '.local/share/zenithjoy');
  const route = yueshengMigrationRoute;
  const journal = join(base, 'device-epoch-migrations', route.physical_serial, 'yuesheng-5044-to-5045');
  mkdirSync(journal, { recursive: true, mode: 0o700 });
  chmodSync(base, sharedMode);

  const { before, after, current_lock: lease, candidate, task } = fixture();
  for (const name of ['device-epoch-fence-yuesheng-host-reads.mjs', 'yuesheng-adb-daemon-binding.py']) {
    candidate.manifest.files.push({ deployed_path: name, path: 'services/phone-adb-controller/' + name, content_sha256: 'a'.repeat(64) });
  }
  task.id = yueshengMaintenanceTask;
  for (const lock of [lease, before.lock, after.lock]) lock.locked_by = task.id;
  const claim = { claimed_by: task.claimed_by, claimed_at: task.claimed_at };
  const plan = { ...route, protocol: 'yuesheng-adb-migration-plan/v1', task_id: task.id, claim, lease,
    source_commit: sha, release_id: releaseId, observation_id: observationId, pending_action_id: observationId };
  const planSha = digest(plan), approvalSha = 'a'.repeat(64);
  const result = { protocol: 'yuesheng-adb-migration-transaction/v1', status: 'observed', plan_sha256: planSha,
    observation: verifyYueshengMigrationReadback({ task, candidate, before, after, current_lock: lease }, now) };
  const between = { observed_at: at(-20_000), old_route: after.old_route, new_route: before.new_route };
  save(join(journal, 'plan.json'), { plan, plan_sha256: planSha, approval_sha256: approvalSha });
  save(join(journal, 'complete.json'), result);
  for (const [name, evidence] of Object.entries({ before, between, after })) save(join(journal, name + '.json'), evidence);
  for (const [operation, endpoint, reply] of [
    ['disconnect', route.old_endpoint, 'disconnected '],
    ['connect', route.new_endpoint, 'connected to '],
  ]) {
    const directory = join(journal, operation + '-wire');
    mkdirSync(directory, { mode: 0o700 });
    const scope = { endpoint, serial: route.transport_serial };
    const response = reply + scope.serial;
    const raw = Buffer.from('OKAY' + response.length.toString(16).padStart(4, '0') + response);
    const outcome = { operation, scope, wire_complete: true, peer_eof: true, socket_closed: true, pending: 0,
      raw_sha256: digest(raw), action_confirmed: true, write_attempted: true, write_acknowledged: true, response };
    save(join(journal, operation + '-intent.json'), { operation, scope, plan_sha256: planSha, at: at(-21_000) });
    save(join(journal, operation + '-result.json'), outcome);
    save(join(directory, 'result.json'), outcome);
    save(join(directory, 'host-response.raw'), raw);
  }

  const policyValue = { endpoint: route.new_endpoint, instance_id: route.new_instance_id, schema_version: 2 };
  const policyDirectory = join(home, '.config/zenithjoy/adb-instances');
  mkdirSync(policyDirectory, { recursive: true, mode: 0o700 });
  const policyPath = join(policyDirectory, route.new_instance_id + '.json');
  save(policyPath, policyValue);
  const policy = { kind: 'managed', instance_id: route.new_instance_id, policy_path: policyPath, policy: policyValue };
  const host = { target: 'mmv', serial: route.physical_serial, profile: 'wuying_android14', expected_account: 'fixture' };
  const company = { company_id: releaseId, tenant_id: observationId, version: 1, policy_id: 'fixture' };
  const daemons = {
    old: { endpoint: route.old_endpoint, kind: 'external_existing', child: { pid: 4444 } },
    next: { endpoint: route.new_endpoint, kind: 'managed', startup: { source_commit: sha }, child: { pid: 4445 } },
  };
  let releases = 0;
  if (sharedSymlink) {
    const target = join(home, 'shared');
    renameSync(base, target);
    symlinkSync(target, base);
  }
  const issue = createYueshengEpochIssuer({
    home, daemons, bindDaemon: async expected => expected, readCompany: async () => company,
    registration: () => ({ host, policy }), ensureRecords: path => mkdirSync(path, { recursive: true, mode: 0o700 }),
    previousClearance: { task_id: releaseId, settlement_sha256: 'b'.repeat(64) },
    source: () => ({ commit: sha, files: {} }), now: () => now,
    async release({ scope, lease: expected, readAuthority }) {
      await readAuthority();
      releases++;
      if (releaseUnknown) return { status: 'unknown', error_code: 'CENTRAL_READBACK_UNKNOWN' };
      const current = { device_name: expected.device_name, locked_by: null, locked_at: null, expires_at: null, lease_version: '19' };
      return { status: 'released', receipt: { scope, expected, current } };
    },
    releaseProof: receipt => receipt,
  });
  const run = () => issue({ journal, plan, candidate, result, assertHeld: async () => {},
    assertAuthority: async () => ({ task, lease, approvalSha }) });
  return { run, home, base, journal, releases: () => releases };
}

test('real file issuer seals the wire receipts and verifies the issued reference', async t => {
  const fixture = setup(t, { sharedMode: 0o755 });
  const reference = await fixture.run();
  const raw = readFileSync(reference.path);
  assert.equal(digest(raw), reference.sha256);
  assert.equal(fixture.releases(), 1);
  const record = JSON.parse(raw);
  assert.equal(readYueshengEpochCompletion(record, { home: fixture.home }), record.migration.completion_sha256);
  assert.equal(record.migration.central_release.current.locked_by, null);
  assert.equal(statSync(fixture.base).mode & 0o777, 0o755);
  assert.equal(statSync(fixture.journal).mode & 0o777, 0o700);
  assert.equal(statSync(join(fixture.base, 'device-epoch-fences', record.resource.serial)).mode & 0o777, 0o700);
});

test('issuer rejects an externally writable or symlinked shared root', t => {
  for (const options of [{ sharedMode: 0o775 }, { sharedMode: 0o757 }, { sharedSymlink: true }]) {
    assert.throws(() => setup(t, options), { code: 'YUESHENG_MIGRATION_ISSUE_ROOT' });
  }
});

test('a shared root does not relax the private wire receipt directory', async t => {
  const fixture = setup(t, { sharedMode: 0o755 });
  chmodSync(join(fixture.journal, 'connect-wire'), 0o755);
  await assert.rejects(fixture.run(), { code: 'FENCE_PRIVATE_DIRECTORY' });
  assert.equal(fixture.releases(), 0);
});

test('changed raw wire receipt stops before release', async t => {
  const fixture = setup(t);
  writeFileSync(join(fixture.journal, 'connect-wire', 'host-response.raw'), 'changed');
  await assert.rejects(fixture.run(), { code: 'YUESHENG_MIGRATION_ISSUE_WIRE' });
  assert.equal(fixture.releases(), 0);
});

test('an unconfirmed lease release leaves a durable result and cannot be retried', async t => {
  const fixture = setup(t, { releaseUnknown: true });
  await assert.rejects(fixture.run(), { code: 'YUESHENG_MIGRATION_ISSUE_RELEASE' });
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.journal, 'central-release-unknown.json'))), {
    status: 'unknown', error_code: 'CENTRAL_READBACK_UNKNOWN', retry_allowed: false,
  });
  await assert.rejects(fixture.run(), { code: 'EEXIST' });
  assert.equal(fixture.releases(), 1);
});
