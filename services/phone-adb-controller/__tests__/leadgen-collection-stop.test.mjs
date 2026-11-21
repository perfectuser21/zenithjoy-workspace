import assert from 'node:assert/strict';
import test from 'node:test';
import { attestCollectionStopped } from '../leadgen-foundation/collection-stop.mjs';

const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const nonce = '33333333-3333-4333-8333-333333333333';
const now = 100_000;
const context = {
  assigned_workflow: '102',
  tasks: { '102': { task_id: taskId, run_id: runId, run_tag: runId } },
  local_owner: 'wf102-' + runId,
  central_owner: taskId,
  serial: 'fixture-android',
  business_deadline_ms: now - 2_000,
  cleanup_deadline_ms: now + 60_000,
};
const request = {
  protocol: 'commander-stop-check/v1',
  identity: { task_id: taskId, run_id: runId, activity_key: 'collection' },
  nonce,
  source_deadline_ms: context.business_deadline_ms,
  cleanup_deadline_ms: context.cleanup_deadline_ms,
};

function fixture() {
  const receipts = [{ path: 'receipts/profile-link.json', activity: 'collection', state: 'terminal', started_at: 30, ended_at: 98, exit_code: 0 }];
  const native = {
    preflight: { hardware_serial: context.serial },
    local_lock: { lock: 'held', owner: context.local_owner },
    operations: { live_pids: [], native_process_count: 0 },
  };
  const central = { locks: [{ device_name: context.serial, locked_by: taskId, lease_version: '42', expires_at: new Date(now + 10_000).toISOString() }] };
  const deps = { hostReceipts: () => receipts, nativeRead: async () => native, brainGet: async () => central, now: () => now };
  return { receipts, native, central, deps };
}

test('attests the stopped collection only with terminal receipts and exact active owners', async () => {
  const { deps } = fixture();
  const proof = await attestCollectionStopped(request, context, deps);
  assert.equal(proof.execution_stopped, true);
  assert.equal(proof.nonce, nonce);
  assert.deepEqual(proof.identity, request.identity);
  assert.equal(proof.evidence.device_serial, context.serial);
  assert.match(proof.evidence.receipt_list_sha256, /^[a-f\d]{64}$/);
});

test('rejects an in-flight action, a changing ledger and unknown or live native processes', async () => {
  for (const change of [
    f => { f.receipts[0].state = 'unknown'; },
    f => { f.native.operations.live_pids.push(98); },
    f => { delete f.native.operations.native_process_count; },
    f => { f.native.operations.native_process_count = 1; },
    f => { f.native.preflight.hardware_serial = 'other-android'; },
    f => { f.native.local_lock.owner = 'foreign'; },
    f => { f.deps.nativeRead = async () => { f.receipts.push({ ...f.receipts[0], path: 'another' }); return f.native; }; },
    f => { f.central.locks[0].locked_by = 'foreign'; },
    f => { f.central.locks[0].expires_at = new Date(now).toISOString(); },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(attestCollectionStopped(request, context, f.deps), /COLLECTION_STOP_UNCONFIRMED/);
  }
});

test('rejects another task or run and reads no adapter before the source deadline', async () => {
  const { deps } = fixture();
  deps.hostReceipts = () => assert.fail('invalid request read resources');
  for (const invalid of [
    { ...request, source_deadline_ms: now + 1 },
    { ...request, cleanup_deadline_ms: now },
    { ...request, identity: { ...request.identity, task_id: runId } },
    { ...request, identity: { ...request.identity, run_id: taskId } },
    { ...request, identity: { ...request.identity, activity_key: 'cleanup' } },
  ]) await assert.rejects(attestCollectionStopped(invalid, context, deps), /COLLECTION_STOP_UNCONFIRMED/);
});
