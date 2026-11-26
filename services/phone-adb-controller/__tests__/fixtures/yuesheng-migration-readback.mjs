import { readFileSync } from 'node:fs';
import { digest } from '../../device-epoch-fence-reference.mjs';

export const now = Date.parse('2026-11-26T10:45:00Z');
export const oldEndpoint = 'tcp:127.0.0.1:5044';
export const newEndpoint = 'tcp:127.0.0.1:5045';
export const physicalSerial = 'B114E2190975';
export const transportSerial = '127.0.0.1:15555';
export const sha = 'a24ae2230abbc00a09918e01298f2affdcc28ac7';
export const releaseId = '11111111-1111-4111-8111-111111111111';
export const observationId = '22222222-2222-4222-8222-222222222222';
export const taskId = '33333333-3333-4333-8333-333333333333';
const registryPath = 'config/adb-host-instances.json';
const pinnedFiles = [registryPath, 'adb-host-instance-policy.py', 'adb-host-service.py', 'device-epoch-fence-review.mjs'];
export const at = offset => new Date(now + offset).toISOString();
export const route = (endpoint, devices) => ({ host_id: 'mmv', endpoint, port: Number(endpoint.split(':').at(-1)), devices });

export function fixture(referenceTime = now) {
  const at = offset => new Date(referenceTime + offset).toISOString();
  const task = { id: taskId, status: 'in_progress', claimed_by: 'maintenance-owner', claimed_at: at(-90000) };
  const lock = { device_name: physicalSerial, locked_by: task.id, lease_version: '55042631', locked_at: at(-80000), expires_at: at(15000), expired: false };
  const live = [{ serial: transportSerial, state: 'device' }];
  const reading = (endpoint, observedAt) => ({ endpoint, transport_serial: transportSerial, observed_at: observedAt, 'ro.serialno': { exit: 0, value: physicalSerial, diagnostic: '' } });
  return {
    task,
    candidate: {
      manifest: { source_commit: sha, source_repo: 'perfectuser21/zenithjoy-workspace', target: 'mmv', environment: `staging:${sha}`, release_id: releaseId, observation_id: observationId,
        files: pinnedFiles.map(name => ({ path: `services/phone-adb-controller/${name}`, deployed_path: name, content_sha256: digest(readFileSync(new URL('../../' + name, import.meta.url))) })) },
      gate: { release_id: releaseId, current_observation_id: observationId, deployed: true, actual_matches: true, gaps: [] },
    },
    before: { observed_at: at(-45000), lock: { ...lock }, old_route: route(oldEndpoint, live), new_route: route(newEndpoint, []), physical_readback: reading(oldEndpoint, at(-45000)) },
    after: { observed_at: at(-4000), lock: { ...lock }, old_route: route(oldEndpoint, []), new_route: route(newEndpoint, live), physical_readback: reading(newEndpoint, at(-4000)) },
    current_lock: { ...lock },
  };
}
