import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readBoundAdbDaemon } from './device-epoch-fence-admission.mjs';
import { validateAuthReference } from './device-epoch-fence-auth-reference.mjs';
import { readDeclaredFenceInstance, readPrivateFenceDaemon, verifyLegacyControllerSource } from './device-epoch-fence-controller.mjs';
import { readDiagnosticProof, runDiagnostic } from './device-epoch-fence-diagnostics.mjs';
import { bytes, canonical, digest, readPrivatePolicy } from './device-epoch-fence-reference.mjs';
import { readOldDaemon } from './device-epoch-fence-review.mjs';
import { consoleShellIsOutsideOldDomain, parseSdk31Diagnostics, verifyConsoleProcessIdentity } from './device-epoch-fence-sdk31.mjs';
import { hostOperation, parseDeviceInventory } from './device-epoch-fence-transport.mjs';
import { collectDeployment } from './deployment-manifest.mjs';
import { verifyTargetRelease } from './deployment-targets.mjs';
import { loadPreflightPg } from './preflight-pg-dependencies.mjs';
import { maintenanceBrainRequest } from './qualification-maintenance-brain.mjs';
import { readMaintenanceDatabaseConfig } from './qualification-maintenance-database.mjs';
import { cloudFenceOperator, cloudFenceOriginal, cloudFenceRoute as route } from './device-epoch-fence-cloud-migration.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const providerTask = '1b0c2057-e381-4c65-bce5-bc93774fcf04';
const repo = 'perfectuser21/zenithjoy-workspace';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const same = (a, b) => canonical(a) === canonical(b);

function need(value, reason) {
  if (value) return;
  const code = 'CLOUD_FENCE_' + reason;
  throw Object.assign(Error(code), { code });
}

// Brain's shared Task-read limit is 300/min. One CLI invocation starts at
// most 172/min and leaves room for other callers. Gate only the starts so
// slow responses cannot turn into queued outgoing requests in a later burst.
export function createCloudBrainReadPacer(request, { now = () => performance.now(), sleep = delay } = {}) {
  const intervalMs = 350;
  const maxQueueMs = 5000;
  let nextStart = 0;
  let queue = Promise.resolve();
  return async function read(path) {
    if (!path.startsWith('/tasks/')) return request(path);
    const expiresAt = now() + maxQueueMs;
    const slot = queue.then(async () => {
      const startAt = Math.max(nextStart, now());
      need(startAt < expiresAt, 'BRAIN_READ_PACING_TIMEOUT');
      const wait = Math.ceil(startAt - now());
      if (wait > 0) await sleep(wait);
      const startedAt = now();
      need(startedAt < expiresAt, 'BRAIN_READ_PACING_TIMEOUT');
      nextStart = startedAt + intervalMs;
      return { response: request(path) };
    });
    queue = slot.then(() => undefined, () => undefined);
    return (await slot).response;
  };
}

function readLegacySource(statePath, home) {
  need(resolve(statePath) === statePath && statePath.startsWith(join(home, '.local/share') + '/')
    && basename(statePath) === cloudFenceOriginal.run_id + '.json', 'ORIGINAL_PATH');
  const state = JSON.parse(bytes(statePath));
  const config = state.profile?.domain_adapter?.config;
  need(state.status === 'unknown' && state.identity?.task_id === cloudFenceOriginal.task_id
    && state.identity?.run_id === cloudFenceOriginal.run_id
    && config?.resources?.serial === route.serial && config.resources?.profile === route.profile
    && config.resources.line === 'yuesheng' && config.env?.ADB_SERVER_SOCKET === route.old_endpoint, 'ORIGINAL_SOURCE');
  const preflight = JSON.parse(bytes(join(statePath.slice(0, -5), 'public-execution-preflight.json')));
  need(preflight?.execution_stopped === false && preflight.external_effect === 'unknown', 'ORIGINAL_SOURCE');
  return { family: verifyLegacyControllerSource(statePath), resource: config.resources, company: config.company };
}

function checkReconnectConsumers(home) {
  const own = 'gui/' + process.getuid() + '/';
  const known = [
    ['com.zenithjoy.wuying-four-exits', join(home, '.local/share/zenithjoy/wuying-four-exits/supervisor.py')],
    ['com.zenithjoy.cloud-nas-network-monitor', join(home, '.local/state/zenithjoy/diagnostics/nas-exit-cutover-20261027/probe-watchdog.py')],
  ];
  const options = { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8',
    timeout: 4000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  for (const [label] of known) {
    const result = spawnSync('/bin/launchctl', ['print', own + label], options);
    need(!result.error && result.signal === null && result.status !== 0
      && /Could not find service|Service not found/i.test(result.stderr), 'OLD_CONSUMER_ACTIVE');
  }
  const processes = execFileSync('/bin/ps', ['-axo', 'uid=,pid=,pgid=,command='], options);
  need(processes.length > 0 && !known.some(([label, script]) => processes.includes(script) || processes.includes(label)),
    'OLD_CONSUMER_ACTIVE');
  return digest({ observed_absent: known });
}

async function readCompany(manifest, legacy, runtimeRoot) {
  const dep = manifest.dependencies?.preflight_pg;
  need(dep?.source_commit === manifest.source_commit, 'COMPANY_SOURCE');
  const { Pool } = loadPreflightPg({ runtimeRoot, frozen: {
    deployment: { source_commit: manifest.source_commit },
    preflight_pg: { lock_sha256: dep.lock_sha256, package_lock_sha256: dep.package_lock_sha256 },
  } });
  const pool = new Pool({ ...readMaintenanceDatabaseConfig(), max: 1, connectionTimeoutMillis: 5000,
    query_timeout: 5000, options: '-c default_transaction_read_only=on' });
  try {
    const { rows } = await pool.query(`SELECT company_id, tenant_id, config_version AS version,
         runtime_config->>'policy_id' AS policy_id
      FROM zenithjoy.tenant_company_profiles
      WHERE runtime_config->'routing'->>'line_key' = $1 AND config_status = 'enabled'`, [legacy.resource.line]);
    need(rows.length === 1, 'COMPANY');
    const company = { ...rows[0], version: Number(rows[0].version) };
    need(company.company_id === legacy.company.company_id && company.tenant_id === legacy.company.tenant_id
      && Number.isSafeInteger(company.version) && company.version > 0 && company.policy_id?.trim(), 'COMPANY');
    return company;
  } finally { await pool.end(); }
}

function verifyCandidateFiles(root, manifest) {
  const issuerFiles = [
    'device-epoch-fence-cloud-execution.mjs', 'device-epoch-fence-cloud-guard.py',
    'device-epoch-fence-cloud-host-reads.mjs', 'device-epoch-fence-cloud-local-guard.mjs',
    'device-epoch-fence-cloud-migration.mjs',
    'config/adb-host-instances.json', 'config/collection-phone-hosts.json',
  ];
  for (const name of issuerFiles) {
    const entries = manifest.files?.filter(row => row.deployed_path === name);
    need(entries?.length === 1 && entries[0].path === 'services/phone-adb-controller/' + name
      && entries[0].content_sha256 === digest(bytes(join(root, name))), 'CANDIDATE_SOURCE');
  }
}

export async function createCloudHostReads({ sourceCommit, taskId, stateFile, authRef, scratchRoot,
  home = userInfo().homedir, request = maintenanceBrainRequest }) {
  need(process.platform === 'darwin' && /^[a-f0-9]{40}$/.test(sourceCommit ?? '')
    && uuid.test(taskId ?? ''), 'HOST_SCOPE');
  const candidate = join(home, '.local/share/zenithjoy/phone-candidates', sourceCommit);
  const runtimeRoot = join(candidate, 'runtime');
  need(here === runtimeRoot, 'EXECUTION_SOURCE');
  const legacy = readLegacySource(stateFile, home);
  const registered = JSON.parse(bytes(join(runtimeRoot, 'config/collection-phone-hosts.json')));
  const matches = registered.hosts.filter(row => row.target === 'mmv' && row.profile === route.profile && row.serial === route.serial);
  const host = matches[0];
  need(matches.length === 1 && host.workflow_keys.includes('douyin_video_discovery') && host.policy.endpoint === route.old_endpoint
    && host.expected_account === legacy.resource.account, 'CLOUD_REGISTRATION');
  const oldPolicyPath = join(home, '.config/zenithjoy/adb-service.json');
  const oldPolicy = JSON.parse(readPrivatePolicy(oldPolicyPath));
  need(same(oldPolicy, host.policy), 'OLD_POLICY');
  const instance = readDeclaredFenceInstance(route.instance_id);
  const currentPolicy = readPrivatePolicy(instance.policy_path);
  need(instance.policy.endpoint === route.new_endpoint && same(JSON.parse(currentPolicy), instance.policy), 'MANAGED_POLICY');
  const daemons = {
    old: readOldDaemon({ home, endpoint: route.old_endpoint, policy: oldPolicy }),
    next: readPrivateFenceDaemon({ ...instance, policy_sha256: digest(currentPolicy) }),
  };
  const readBrain = createCloudBrainReadPacer(request);
  const readTask = async id => {
    const reply = await readBrain('/tasks/' + id);
    return reply.task ?? reply;
  };
  const readAuthority = async () => {
    const [task, originalTask, operatorTask, deviceLocks] = await Promise.all([
      readTask(taskId), readTask(cloudFenceOriginal.task_id), readTask(cloudFenceOperator.task_id), readBrain('/device-locks'),
    ]);
    return { task, originalTask, operatorTask, deviceLocks };
  };
  const readCandidate = async () => {
    const manifest = JSON.parse(readPrivatePolicy(join(runtimeRoot, 'deployment-manifest.json')));
    const marker = JSON.parse(readPrivatePolicy(join(candidate, 'candidate-identity.json')));
    need(manifest.target === 'mmv' && manifest.source_repo === repo && manifest.source_commit === sourceCommit
      && manifest.environment === 'staging:' + sourceCommit
      && uuid.test(manifest.release_id ?? '') && uuid.test(manifest.observation_id ?? '')
      && marker.source_commit === sourceCommit && marker.release_id === manifest.release_id, 'CANDIDATE');
    verifyCandidateFiles(runtimeRoot, manifest);
    const endpoint = '/releases/' + manifest.release_id;
    const [releaseReply, gate, observationReply] = await Promise.all([
      readBrain(endpoint), readBrain(endpoint + '/gate'), readBrain(endpoint + '/observations/' + manifest.observation_id),
    ]);
    const release = verifyTargetRelease(releaseReply.release, 'mmv', sourceCommit, undefined, manifest.environment);
    const observation = observationReply.observation;
    need(marker.manifest_sha256 === release.manifest_sha256 && release.id === manifest.release_id
      && gate.deployed === true && gate.actual_matches === true && gate.current_observation_id === manifest.observation_id
      && Array.isArray(gate.gaps) && gate.gaps.length === 0
      && observation.id === manifest.observation_id && observation.release_id === release.id
      && observation.payload_sha256 === digest(observation.payload)
      && observation.payload?.target === 'mmv' && observation.payload.environment === manifest.environment
      && same(observation.payload.components, release.payload.components), 'CANDIDATE_READBACK');
    const observed = collectDeployment(runtimeRoot, manifest);
    need(observation.payload.evidence_ref === 'deployment-sha256:' + digest(observed), 'CANDIDATE_READBACK');
    const resource = { serial: route.serial, profile: route.profile, expected_account: host.expected_account,
      line: legacy.resource.line, company: await readCompany(manifest, legacy, runtimeRoot) };
    return { manifest: { ...manifest, manifest_sha256: marker.manifest_sha256 }, gate, resource };
  };
  async function authority({ lease, claim, assertAuthority, assertHeld }, daemon) {
    await assertHeld?.();
    if (assertAuthority) {
      const observed = await assertAuthority();
      need(same(observed.lease, lease), 'LEASE_DRIFT');
    } else {
      const { task, originalTask, deviceLocks } = await readAuthority();
      const rows = deviceLocks.locks?.filter(row => row.device_name === route.serial);
      need(deviceLocks.success === true && task.id === taskId && task.status === 'in_progress'
        && task.claimed_by === claim.claimed_by && task.claimed_at === claim.claimed_at && originalTask.status === 'blocked'
        && originalTask.result?.execution_stopped !== true && rows?.length === 1
        && Object.keys(lease).every(key => rows[0][key] === lease[key]), 'LEASE_DRIFT');
    }
    need(Date.parse(lease.expires_at) > Date.now() + 5000, 'LEASE_DRIFT');
    readBoundAdbDaemon(daemon);
    await assertHeld?.();
    return lease.expires_at;
  }
  async function inventory(daemon, context) {
    const scope = { endpoint: daemon.endpoint, serial: route.serial };
    const receipt = await hostOperation({ operation: 'inventory', scope,
      directory: mkdtempSync(join(scratchRoot, 'inventory-')),
      readAuthority: async () => ({ scope, authorized_action: 'inventory', lease_until: await authority(context, daemon) }) });
    need(receipt.wire_complete && receipt.action_confirmed && receipt.peer_eof && receipt.socket_closed, 'INVENTORY_WIRE');
    return parseDeviceInventory(receipt.response);
  }
  async function observe(phase, context) {
    const legacyNow = readLegacySource(stateFile, home);
    need(same(legacy, legacyNow), 'ORIGINAL_SOURCE');
    const provider = await readTask(providerTask);
    const proof = validateAuthReference({ refPath: authRef, task: provider, instance });
    need(proof.ref.resource.serial === route.serial && proof.ref.resource.cloud_instance_id
      && sha.test(proof.auth.ref_sha256) && sha.test(proof.auth.public_key_sha256), 'PROVIDER_BINDING');
    const providerBindingSha = digest({ resource: proof.ref.resource, ref_sha256: proof.auth.ref_sha256,
      public_key_sha256: proof.auth.public_key_sha256 });
    const initialConsumers = checkReconnectConsumers(home);
    const inventoryBoth = () => Promise.all([inventory(daemons.old, context), inventory(daemons.next, context)]);
    const [old, next] = await inventoryBoth();
    need(old.length === (phase === 'before' ? 1 : 0)
      && (phase === 'after' || (old[0]?.serial === route.serial && old[0].state === 'unauthorized'))
      && next.length === 1 && next[0]?.serial === route.serial && next[0].state === 'device', 'ROUTES');
    const diagnosticFiles = [];
    async function query(name, pid) {
      const scope = { endpoint: route.new_endpoint, serial: route.serial, maintenance_task_id: taskId,
        ...(pid === undefined ? {} : { diagnostic_process_pid: pid }) };
      const directory = mkdtempSync(join(scratchRoot, 'diagnostic-' + name + '-'));
      const receipt = await runDiagnostic({ query: name, scope, directory,
        readAuthority: async () => ({ scope, lease_until: await authority(context, daemons.next) }) });
      const evidence = readDiagnosticProof(receipt);
      need(evidence.wire_complete && evidence.exit_code === 0 && evidence.stderr.length === 0
        && evidence.query === name && same(evidence.scope, scope), 'DIAGNOSTIC');
      diagnosticFiles.push({ directory, query: name, pid: pid ?? null, stdout_sha256: digest(evidence.stdout) });
      return evidence.stdout.toString('utf8');
    }

    const sdk = await query('sdk'), bootId = await query('boot_id'), hardware = await query('hardware_serial');
    need(sdk === '31\n' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\n$/.test(bootId)
      && /^[A-Za-z0-9_.:-]{1,128}\r?\n$/.test(hardware) && !/^(?:unknown|null)\r?\n$/i.test(hardware), 'HANDSET_IDENTITY');
    async function readQuiescence() {
      const bundle = { sdk, boot_id: bootId };
      for (const name of ['processes', 'input', 'activity']) bundle[name] = await query(name);
      const facts = parseSdk31Diagnostics(bundle);
      need(facts.processes.inventory_complete && facts.processes.old_producers.length === 0
        && facts.input.queue_idle && facts.activities.records_idle, 'NONINTERFERENCE');
      return facts;
    }
    const first = await readQuiescence();
    const excluded = [];
    for (const process of first.processes.unresolved_shells) {
      need(excluded.length === 0, 'NONINTERFERENCE');
      const value = { process, controllerSourceSha256: legacy.family.controller_sha256 };
      for (const key of ['stat', 'status', 'cmdline', 'fds', 'wchan']) value[key] = await query('process_' + key, process.pid);
      excluded.push(consoleShellIsOutsideOldDomain(value));
    }
    const final = await readQuiescence();
    need(final.processes.unresolved_shells.every(process => excluded.some(owner =>
      owner.pid === process.pid && owner.uid === process.uid && owner.ppid === process.ppid)), 'NONINTERFERENCE_DRIFT');
    const finalBoot = await query('boot_id');
    for (const owner of excluded) verifyConsoleProcessIdentity({
      excluded: owner, stat: await query('process_stat', owner.pid), bootId: finalBoot, expectedBootId: bootId,
    });
    need(finalBoot === bootId && await query('hardware_serial') === hardware, 'HANDSET_IDENTITY_DRIFT');
    need(same(await inventoryBoth(), [old, next]) && checkReconnectConsumers(home) === initialConsumers, 'ROUTES_DRIFT');
    await Promise.all([authority(context, daemons.old), authority(context, daemons.next)]);
    return {
      provider_binding_sha256: providerBindingSha,
      hardware_serial_sha256: digest(hardware.trim()), boot_id_sha256: digest(bootId.trim()),
      old_daemon_sha256: digest(daemons.old), new_daemon_sha256: digest(daemons.next),
      consumer_readback_sha256: initialConsumers, noninterference_sha256: digest({
        diagnosticFiles, excluded, original_execution_stopped: false, android_internal: 'not_attested',
      }),
      old_device: old[0] ?? null, new_device: next[0], observed_at: new Date().toISOString(),
    };
  }
  const verifyRoutes = async ({ lease, assertAuthority, before }) => {
    const context = { lease, assertAuthority };
    const [old, next] = await Promise.all([inventory(daemons.old, context), inventory(daemons.next, context)]);
    need(same(old, before.old_device === null ? [] : [before.old_device]) && same(next, [before.new_device])
      && checkReconnectConsumers(home) === before.consumer_readback_sha256, 'ROUTES_DRIFT');
  };
  return { daemons, host, instance, readBrain, readAuthority, readCandidate, observe, verifyRoutes,
    assertConsumerAbsent: () => checkReconnectConsumers(home) };
}
