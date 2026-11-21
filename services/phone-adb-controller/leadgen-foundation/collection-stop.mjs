import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requireProof = condition => {
  if (!condition) throw Error('COLLECTION_STOP_UNCONFIRMED');
};

export async function attestCollectionStopped(request, context, facts) {
  const { identity, nonce, source_deadline_ms: sourceDeadline, cleanup_deadline_ms: cleanupDeadline } = request ?? {};
  const task = context.tasks?.['102'];
  const now = facts.now ?? Date.now;
  requireProof(request?.protocol === 'commander-stop-check/v1'
    && uuid.test(task?.task_id ?? '') && uuid.test(task?.run_id ?? '') && uuid.test(nonce ?? '')
    && context.assigned_workflow === '102' && identity?.activity_key === 'collection'
    && identity.task_id === task.task_id && identity.run_id === task.run_id && task.run_tag === task.run_id
    && context.local_owner === 'wf102-' + task.run_id && context.central_owner === task.task_id
    && typeof context.serial === 'string' && context.serial
    && Number.isSafeInteger(sourceDeadline) && sourceDeadline <= context.business_deadline_ms
    && Number.isSafeInteger(cleanupDeadline) && cleanupDeadline === context.cleanup_deadline_ms
    && sourceDeadline <= now() && now() < cleanupDeadline);

  const receipts = facts.hostReceipts(task);
  requireProof(receipts.some(row => row.activity === 'collection')
    && receipts.every(row => row.state === 'terminal' && Number.isFinite(row.ended_at) && Number.isInteger(row.exit_code)));
  const receiptDigest = digest(receipts);
  const [native, central] = await Promise.all([
    facts.nativeRead(context, task.run_tag),
    facts.brainGet('/device-locks', context),
  ]);
  const leases = central?.locks?.filter(row => row.device_name === context.serial);
  const lease = leases?.[0];
  const observedAt = now();
  requireProof(observedAt < cleanupDeadline && digest(facts.hostReceipts(task)) === receiptDigest
    && native?.preflight?.hardware_serial === context.serial
    && native.local_lock?.lock === 'held' && native.local_lock.owner === context.local_owner
    && native.operations?.native_process_count === 0
    && Array.isArray(native.operations.live_pids) && native.operations.live_pids.length === 0
    && leases?.length === 1 && lease.locked_by === task.task_id && /^[1-9][0-9]{0,9}$/.test(lease.lease_version ?? '')
    && Date.parse(lease.expires_at) > observedAt);

  return { identity, nonce, execution_stopped: true, evidence: {
    observed_at_ms: observedAt, device_serial: context.serial,
    local_owner: context.local_owner, lease_version: lease.lease_version,
    receipt_list_sha256: receiptDigest, terminal_receipts: receipts.length,
  } };
}
