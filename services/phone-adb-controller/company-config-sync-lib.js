'use strict';
const { isDeepStrictEqual } = require('node:util');
const equal = isDeepStrictEqual;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Three-way edits never silently overwrite simultaneous edits. Conflict choices
 * must be resolved by the owner; current PG values remain until that decision. */
function mergeProjectionEdit({ base, current, incoming }) {
  const conflicts = [];
  const merge = (old, live, edit, path) => {
    if (equal(edit, old) || equal(edit, live)) return structuredClone(live);
    if (equal(live, old)) return structuredClone(edit);
    if (plain(old) && plain(live) && plain(edit)) {
      const result = {};
      for (const key of new Set([...Object.keys(old), ...Object.keys(live), ...Object.keys(edit)])) {
        const value = merge(old[key], live[key], edit[key], [...path, key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflicts.push({ path: path.join('.'), base: old, current: live, incoming: edit, status: 'pending_owner_resolution' });
    return structuredClone(live);
  };
  return { merged: merge(base, current, incoming, []), conflicts };
}
function validateMapping(mapping, snapshot) {
  if (!mapping?.target) return false;
  if (mapping.company_id !== snapshot.company_id || mapping.tenant_id !== snapshot.tenant_id) throw Error('projection mapping identity mismatch');
  return true;
}
/** Adapter must read a projection snapshot, write idempotently, independently
 * read back from the platform, and persist old/new/readback/conflict evidence. */
async function synchronizeProjection({ snapshot, platform, mapping, adapter }) {
  if (!validateMapping(mapping, snapshot)) return { platform, status: 'unmapped', reason: 'projection_target_missing' };
  for (const method of ['read', 'write', 'readback', 'record']) {
    if (typeof adapter?.[method] !== 'function') throw Error(`projection adapter missing ${method}`);
  }
  const request_id = `${snapshot.company_id}:${snapshot.config_version}:${platform}:${mapping.target}`;
  const old_snapshot = await adapter.read(mapping);
  if (old_snapshot && (old_snapshot.company_id !== snapshot.company_id || old_snapshot.tenant_id !== snapshot.tenant_id)) throw Error('projection read identity mismatch');
  const base_snapshot = old_snapshot && adapter.readBase ? await adapter.readBase(old_snapshot.config_version) : null;
  if (old_snapshot && ((old_snapshot.config_version >= snapshot.config_version && !equal(old_snapshot, snapshot)) || (adapter.readBase && !equal(old_snapshot, base_snapshot)))) {
    const evidence = { request_id, platform, status: 'conflict', old_snapshot, new_snapshot: snapshot, conflict: { reason: 'projection_changed_without_owner_resolution', base_snapshot } };
    await adapter.record(evidence); return evidence;
  }
  const baseEvidence = { request_id, platform, old_snapshot, new_snapshot: snapshot };
  if (!equal(old_snapshot, snapshot)) await adapter.record({ ...baseEvidence, status: 'pending' });
  try {
    if (!equal(old_snapshot, snapshot)) await adapter.write(mapping, snapshot, { request_id, expected_version: old_snapshot?.config_version ?? null, expected_snapshot: old_snapshot });
    const readback = await adapter.readback(mapping);
    const evidence = { ...baseEvidence, status: equal(readback, snapshot) ? 'consistent' : 'mismatch', readback };
    await adapter.record(evidence); return evidence;
  } catch (error) {
    try { await adapter.record({ ...baseEvidence, old_snapshot: error.latest_snapshot === undefined ? old_snapshot : error.latest_snapshot, previous_read_snapshot: old_snapshot, status: error.projection_conflict ? 'conflict' : 'failed', failure: { message: error.message } }); }
    catch (historyError) { error.history_failure = historyError.message; }
    throw error;
  }
}
module.exports = { mergeProjectionEdit, synchronizeProjection, validateMapping };
