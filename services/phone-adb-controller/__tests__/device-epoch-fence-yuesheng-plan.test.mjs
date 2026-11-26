import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest } from '../device-epoch-fence-reference.mjs';
import { yueshengMigrationRoute } from '../device-epoch-fence-yuesheng-readback.mjs';
import { planYueshengMigration } from '../device-epoch-fence-yuesheng-plan.mjs';
import { fixture, now, observationId, releaseId, sha } from './fixtures/yuesheng-migration-readback.mjs';

const taskId = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const actionId = '44444444-4444-4444-8444-444444444444';

function setup(referenceTime = now) {
  const x = fixture(referenceTime);
  const task = { ...x.task, id: taskId, payload: { work_kind: 'coding_review', scope: ['enable_mmv_yuesheng_5045'] } };
  const lease = { ...x.current_lock, locked_by: taskId };
  const action = { id: actionId, action_type: 'owner_decision', status: 'pending_approval', source: 'yuesheng_adb_migration',
    params: { protocol: 'yuesheng-adb-migration-request/v1', task_id: taskId, device_name: lease.device_name,
      lease_version: lease.lease_version, source_commit: sha } };
  const calls = [];
  const replies = {
    ['/tasks/' + taskId]: task,
    ['/pending-actions/' + actionId]: { action },
    '/device-locks': { success: true, locks: [lease] },
    ['/releases/' + releaseId + '/gate']: x.candidate.gate,
  };
  const args = { taskId, pendingActionId: actionId, sourceCommit: sha };
  const io = {
    readBrain: async path => {
      calls.push(path);
      assert.ok(replies[path], path);
      return structuredClone(replies[path]);
    },
    readCandidateManifest: async commit => {
      assert.equal(commit, sha);
      return structuredClone(x.candidate.manifest);
    },
    readBefore: async () => { calls.push('before'); return structuredClone(x.before); },
    now: () => referenceTime,
  };
  return { args, io, replies, task, action, lease, calls, manifest: x.candidate.manifest, before: x.before };
}

test('read-only planning emits the exact canonical approval digest from real Brain response shapes', async () => {
  const x = setup();
  const result = await planYueshengMigration(x.args, x.io);
  const plan = {
    protocol: 'yuesheng-adb-migration-plan/v1',
    task_id: taskId,
    pending_action_id: actionId,
    source_commit: sha,
    release_id: releaseId,
    observation_id: observationId,
    ...yueshengMigrationRoute,
    claim: { claimed_by: x.task.claimed_by, claimed_at: x.task.claimed_at },
    lease: x.lease,
  };
  assert.deepEqual(result, { plan, plan_sha256: digest(plan) });
  assert.equal(x.calls.filter(path => path === '/device-locks').length, 2);
  assert.equal(x.calls.filter(path => path === '/pending-actions/' + actionId).length, 2);
  assert.equal(x.calls.filter(path => path === 'before').length, 1);
});

test('cannot produce an approval digest without the same active task, exact lock and pending action', async () => {
  for (const [mutate, expected] of [
    [x => { x.task.status = 'completed'; }, 'TASK'],
    [x => { x.task.payload.scope = []; }, 'TASK'],
    [x => { x.action.params.task_id = 'wrong'; }, 'PENDING_ACTION'],
    [x => { x.action.status = 'approved'; }, 'PENDING_ACTION'],
    [x => { x.action.source = 'owner_decision_guard'; }, 'PENDING_ACTION'],
    [x => { x.action.params.lease_version = '99'; }, 'PENDING_ACTION'],
    [x => { x.action.params.source_commit = '0'.repeat(40); }, 'PENDING_ACTION'],
    [x => { x.lease.locked_by = null; }, 'LEASE'],
    [x => { x.replies['/device-locks'].locks.push({ ...x.lease }); }, 'LEASE'],
    [x => { x.replies['/releases/' + releaseId + '/gate'].current_observation_id = releaseId; }, 'CANDIDATE_GATE'],
    [x => { const read = x.io.readBefore; x.io.readBefore = async () => { x.lease.lease_version = '99'; return read(); }; }, 'PENDING_ACTION'],
    [x => { const read = x.io.readBefore; x.io.readBefore = async lease => { assert.deepEqual(lease, x.lease); x.task.claimed_by = 'another-worker'; return read(); }; }, 'AUTHORITY_CHANGED'],
    [x => { const read = x.io.readBefore; x.io.readBefore = async () => { x.manifest.files.push({ path: 'changed' }); return read(); }; }, 'CANDIDATE_CHANGED'],
  ]) {
    const x = setup();
    mutate(x);
    await assert.rejects(planYueshengMigration(x.args, x.io), { code: 'YUESHENG_MIGRATION_' + expected });
  }
});

test('CLI reads the installed manifest and private physical evidence, calls only precise GETs, and emits a matching digest', async t => {
  const x = setup(Date.now());
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'yuesheng-plan-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const installed = join(home, '.local/share/zenithjoy/phone-candidates', sha, 'runtime/deployment-manifest.json');
  const before = join(home, 'before.json');
  const preload = join(home, 'readback-fixture.mjs');
  mkdirSync(dirname(installed), { recursive: true });
  mkdirSync(join(home, '.credentials'));
  writeFileSync(join(home, '.credentials/brain.env'), 'BRAIN_INTERNAL_TOKEN=fixture-not-a-credential\n', { mode: 0o600 });
  writeFileSync(installed, JSON.stringify(x.manifest), { mode: 0o600 });
  writeFileSync(before, JSON.stringify(x.before), { mode: 0o600 });
  writeFileSync(preload, `import assert from 'node:assert/strict';
const replies = ${JSON.stringify(x.replies)};
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url.origin, 'http://localhost:5221');
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);
  const path = url.pathname.slice('/api/brain'.length);
  assert.ok(replies[path], path);
  calls.push(path);
  return Response.json(replies[path]);
};
process.on('exit', code => {
  if (code !== 0) return;
  for (const path of Object.keys(replies)) assert.equal(calls.filter(p => p === path).length, 2);
});\n`);
  const script = fileURLToPath(new URL('../device-epoch-fence-yuesheng-plan.mjs', import.meta.url));
  const out = spawnSync(process.execPath, ['--import', preload, script, taskId, actionId, sha, before], {
    env: { ...process.env, HOME: home, BRAIN_URL: 'http://localhost:5221' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), await planYueshengMigration(x.args, x.io));
});
