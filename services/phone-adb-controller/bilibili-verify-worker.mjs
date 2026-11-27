import { execFile } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createCentralDeviceLease } from './central-device-lease.mjs';
import { startCollectionLeafProducer } from './collection-leaf-producer.mjs';
import { digest } from './runtime-definition.mjs';
import { callStandaloneSkillTool } from './standalone-skill-ipc.mjs';
import { serveStandaloneBilibiliVerify } from './standalone-bilibili-verify.mjs';
import { createBilibiliNativeDevice, createBilibiliNativeReader } from './bilibili-verify-native.mjs';
import { assertBilibiliRelease, assertBilibiliWorkspaceJob, BILIBILI_HOST_POLICY_PATH, resolveBilibiliHostPolicy } from './bilibili-verify-release.mjs';

const runFile = promisify(execFile);
const controllerPrefix = 'services/phone-adb-controller/';
const python = '/usr/bin/python3';
const utf8 = bytes => bytes.toString('utf8');
const parse = bytes => JSON.parse(utf8(bytes));
const roles = ['account', 'author', 'detail', 'editor', 'settings', 'player'];
const use = condition => {
  if (!condition) throw Error('standalone_bilibili_scope_unconfirmed');
};

function readOwned(path, max = 8 * 1024 * 1024) {
  use(isAbsolute(path) && realpathSync(path) === path);
  const stat = lstatSync(path);
  use(stat.isFile() && stat.uid === process.getuid() && stat.nlink === 1
    && (stat.mode & 0o022) === 0 && stat.size > 0 && stat.size <= max);
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  use(['dev', 'ino', 'size', 'ctimeMs', 'mtimeMs'].every(key => stat[key] === after[key]) && bytes.length === stat.size);
  return bytes;
}
function trustedDirectory(path, mustBePrivate) {
  use(typeof path === 'string' && isAbsolute(path) && realpathSync(path) === path);
  const stat = lstatSync(path);
  use(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o022) === 0
    && (!mustBePrivate || (stat.mode & 0o777) === 0o700));
  return path;
}
function localPath(root, path) {
  return path.startsWith(controllerPrefix) ? join(root, path.slice(controllerPrefix.length)) : join(root, '_components', path);
}
function requestBody(job) {
  return {
    task_id: job.task_id, claimer: job.claimer, claimed_at: job.claimed_at,
    definition: { ...job.definition, attempt_key: job.task_id + ':1', actor: job.claimer },
    standalone: job.input,
  };
}
function assertReleaseReadback(job, release, gate, observation) {
  use(gate?.deployed === true && gate.actual_matches === true && Array.isArray(gate.gaps) && gate.gaps.length === 0
    && gate.current_observation_id === job.definition.observation_id
    && observation?.id === gate.current_observation_id && observation.release_id === release.id
    && observation.payload?.target === 'xian-m4' && observation.payload?.environment === release.environment
    && digest(observation.payload.components) === digest(release.payload.components));
}
export function readBilibiliVerifyReceipt(root, scope) {
  const result = parse(readOwned(join(root, 'bilibili-existing', 'receipt.json')));
  const expected = {
    protocol: 'bilibili-verify-existing/v1', run_id: scope.runId, source_run_id: scope.sourceRunId, owner: scope.owner,
    profile: scope.profile, serial: scope.serial, bvid: scope.bvid, owner_uid: scope.ownerUid, title: scope.title,
    visibility: 'private', duration_seconds: scope.durationSeconds, outward_actions: 0,
  };
  use(Object.keys(result).sort().join(',') === 'files,observation' && digest(result.observation) === digest(expected)
    && Object.keys(result.files ?? {}).length === roles.length);
  for (const role of roles) {
    const row = result.files?.[role];
    use(Object.keys(row ?? {}).sort().join(',') === 'path,sha256'
      && row.path === role + (role === 'player' ? '.png' : '.xml')
      && /^[a-f0-9]{64}$/.test(row.sha256)
      && digest(readOwned(join(root, 'bilibili-existing', row.path))) === row.sha256);
  }
  return result;
}

export function createProvider(job, options, context) {
  const { scope } = assertBilibiliWorkspaceJob(job);
  use(job.claimer === 'standalone:xian-m4' && typeof job.claimed_at === 'string' && Number.isFinite(Date.parse(job.claimed_at)));
  use(process.platform === 'darwin' && Object.keys(options ?? {}).sort().join(',') === 'evidence_root,host_policy,host_policy_sha256,phone_registry,phone_registry_sha256,runtime_root');
  const policyBytes = readOwned(options.host_policy, 64 * 1024);
  use(digest(policyBytes) === options.host_policy_sha256);
  const registryBytes = readOwned(options.phone_registry, 64 * 1024);
  use(digest(registryBytes) === options.phone_registry_sha256);
  const rawRows = utf8(registryBytes).split(/\r?\n/).map(line => line.split('\t'));
  const header = rawRows.find(row => /^(?:#)?profile$/.test(row[0]));
  const serialColumn = header ? header.indexOf('serial') : 1;
  const deviceRows = rawRows.filter(row => row[0] === scope.profile);
  use(serialColumn >= 1 && deviceRows.length === 1 && deviceRows[0][serialColumn] === scope.serial);
  const runtime = trustedDirectory(options.runtime_root, false);
  const registeredPolicyPath = localPath(runtime, BILIBILI_HOST_POLICY_PATH);
  const evidenceRoot = trustedDirectory(options.evidence_root, true);
  const target = new URL(context.brainUrl);
  use(target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port && target.pathname === '/'
    && !target.username && !target.password && !target.search && !target.hash);
  const token = process.env.CECELIA_INTERNAL_TOKEN;
  use(token && token.trim() === token);
  const headers = { 'content-type': 'application/json', 'x-internal-token': token };
  async function request(path, body) {
    const response = await fetch(new URL('/api/brain/' + path, target), {
      headers, redirect: 'error', signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    use(response.ok);
    return response.json();
  }
  const controller = join(runtime, 'douyin-phone-adb');
  const wrapper = join(runtime, 'adb-managed-client.py');
  const ocrProgram = localPath(runtime, 'scripts/phone-account-patrol/ocr.swift');
  const env = {
    PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: userInfo().homedir,
    LANG: 'en_US.UTF-8', ZJ_ADB_HOST_CONFIG: options.host_policy, P: scope.profile,
    DOUYIN_PHONE_REGISTRY: options.phone_registry,
    WFR_COLLECTION_POLICY_FILE: options.host_policy,
  };
  let leaf, ipc, lease, directory, evidence, started, ended, deadline, cleanupDeadline;
  let registeredPolicySha;
  let local = 'none';
  let closePromise;
  let cleanup = false;
  async function execute(path, args, childEnv = env) {
    const remaining = Math.min(30000, (cleanup ? cleanupDeadline : deadline) - Date.now());
    use(remaining > 0);
    const result = await runFile(path, args, { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: remaining, killSignal: 'SIGKILL', env: childEnv });
    return result.stdout;
  }
  function controllerCall(...args) {
    return execute(controller, ['--profile', scope.profile, ...args], leaf ? { ...env, ...leaf.env } : env);
  }
  async function hold() {
    use(digest(readOwned(options.host_policy, 64 * 1024)) === options.host_policy_sha256);
    use(digest(readOwned(options.phone_registry, 64 * 1024)) === options.phone_registry_sha256);
    use(digest(readOwned(registeredPolicyPath, 64 * 1024)) === registeredPolicySha);
    await lease.verifyHeld();
    if (!cleanup) {
      const task = await request('tasks/' + job.task_id);
      use(task.id === job.task_id && task.status === 'in_progress' && task.claimed_by === job.claimer
        && task.result?.standalone_claim?.run_id === scope.runId && digest(task.payload?.scope) === digest(job.input.scope)
        && digest(task.payload?.skill) === digest(job.input.skill));
    }
    const states = utf8(await controllerCall('lock-status')).split('\n').filter(line => line.startsWith('lock='));
    use(states.length === 1 && states[0].startsWith(`lock=held owner=${scope.owner} `) && states[0].includes('stale=false'));
  }
  async function withPng(bytes, calculate) {
    const scratch = mkdtempSync(join(evidence, 'inspect-'));
    try {
      const original = join(scratch, 'screenshot.png');
      writeFileSync(original, bytes, { flag: 'wx', mode: 0o600 });
      return await calculate(original, scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  function adbCall(argv) {
    return execute(python, ['-I', '-B', wrapper, '-s', scope.serial, ...argv], { ...env, ...leaf.env });
  }
  function makeDevice() {
    return createBilibiliNativeDevice({
      adb: adbCall,
      pause: milliseconds => delay(milliseconds),
      ocr: bytes => withPng(bytes, async path => parse(await execute('/usr/bin/swift', [ocrProgram, path]))),
      contentHash: bytes => withPng(bytes, async (path, scratch) => {
        const cropped = join(scratch, 'content.bmp');
        await execute('/usr/bin/sips', ['-c', '2254', '1080', '--cropOffset', '110', '0',
          '-s', 'format', 'bmp', path, '--out', cropped]);
        return digest(readOwned(cropped, 10 * 1024 * 1024));
      }),
    });
  }
  function close() {
    return closePromise ??= (async () => {
      cleanup = true;
      let nativeUnknown = local === 'unknown';
      let desktop;
      if (ipc) {
        try { await ipc.close(); } catch { nativeUnknown = true; }
      }
      try { if (leaf?.isReturnUnknown()) nativeUnknown = true; } catch { nativeUnknown = true; }
      if (local === 'held' && !nativeUnknown) {
        try {
          await hold();
          desktop = utf8(await controllerCall('--lock-owner', scope.owner, 'return-safe-desktop'));
          const launcher = /^launcher=([\w.]+)$/m.exec(desktop)?.[1];
          use(launcher && new RegExp('^foreground_package=' + launcher.replaceAll('.', '\\.') + '$', 'm').test(desktop));
          const resolved = utf8(await adbCall(['shell', 'cmd', 'package', 'resolve-activity', '--brief',
            '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']));
          const native = resolved.split(/\r?\n/).filter(row => /^[\w.]+\/[\w.$]+$/.test(row));
          const foreground = utf8(await controllerCall('--lock-owner', scope.owner, 'foreground'));
          const observed = /mCurrentFocus=Window\{[^\n]*[ \t]([\w.]+\/[\w.$]+)\}/.exec(foreground)?.[1];
          const expanded = native[0]?.replace('/.', '/' + launcher + '.');
          use(native.length === 1 && expanded?.startsWith(launcher + '/') && observed === expanded);
        } catch { nativeUnknown = true; }
      }
      if (leaf) {
        try {
          const seal = await leaf.seal();
          if (!(seal.requests_returned || seal.empty_requests_returned)) nativeUnknown = true;
        } catch { nativeUnknown = true; }
        leaf = undefined;
      }
      if (local === 'held' && !nativeUnknown) {
        try {
          await controllerCall('lock-release-exact', scope.owner);
          use(utf8(await controllerCall('lock-status')).trim() === 'lock=free');
          local = 'none';
        } catch { nativeUnknown = true; }
      }
      let quarantineVerified = false;
      if (local === 'held' && nativeUnknown) {
        try {
          const output = utf8(await controllerCall('lock-quarantine', scope.owner)).trim();
          quarantineVerified = output === `lock=quarantined owner=${scope.owner} review_required=true`;
        } catch { /* Preserve the held owner and record the failed readback. */ }
      }
      if (!nativeUnknown && local === 'none' && lease?.held) {
        try { await lease.release(); } catch { nativeUnknown = true; }
      }
      const receipt = {
        task_id: job.task_id, run_id: job.run_id, local_released: local === 'none',
        central_released: !lease?.held && !lease?.attempted, native_return_unknown: nativeUnknown,
        quarantine_verified: quarantineVerified, desktop: desktop ?? null,
      };
      if (evidence) writeFileSync(join(evidence, 'cleanup.json'), JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
      return receipt;
    })();
  }
  return {
    async startHost(identity) {
      use(identity.task_id === job.task_id && identity.run_id === job.run_id);
      const releaseKey = 'releases/' + job.definition.release_id;
      const [info, gate, observed] = await Promise.all([
        request(releaseKey), request(releaseKey + '/gate'),
        request(releaseKey + '/observations/' + job.definition.observation_id),
      ]);
      const release = info.release;
      const registeredPolicy = readOwned(registeredPolicyPath, 64 * 1024);
      const frozen = assertBilibiliRelease(release, job, path => path === BILIBILI_HOST_POLICY_PATH
        ? registeredPolicy : readOwned(localPath(runtime, path)));
      registeredPolicySha = digest(registeredPolicy);
      const policy = resolveBilibiliHostPolicy(parse(policyBytes), parse(registeredPolicy), scope);
      assertReleaseReadback(job, release, gate, observed.observation);
      const manifest = parse(readOwned(join(runtime, 'deployment-manifest.json')));
      use(manifest.release_id === release.id && manifest.observation_id === job.definition.observation_id
        && manifest.target === release.target && manifest.environment === release.environment
        && manifest.source_commit === job.input.skill.source_commit
        && frozen.bindings.every(row => manifest.files?.some(file => file.path === row.path
          && file.content_sha256 === row.digest.slice(7) && file.deployed_path === localPath('', row.path))));
      for (const file of ['douyin-phone-adb', 'adb-managed-client.py', 'adb-existing-route.py', 'phone-lock-lib.sh', 'phone-lock-helper.py', 'collection-leaf-producer.mjs']) {
        const component = manifest.files.filter(row => row.deployed_path === file);
        use(component.length === 1 && digest(readOwned(join(runtime, file))) === component[0].content_sha256);
      }
      const opened = await request('runs/' + job.run_id + '/start-skill', requestBody(job));
      use(opened?.run_id === scope.runId && /^[0-9a-f-]{36}$/.test(opened.task_run_id)
        && opened.binding?.release_id === release.id && opened.binding.observation_id === job.definition.observation_id
        && opened.binding.workflow_definition_version_id === frozen.workflow.id
        && digest(opened.binding.expected_path) === digest(job.definition.expected_path));
      deadline = Date.now() + 480000;
      cleanupDeadline = deadline + 90000;
      evidence = join(evidenceRoot, scope.runId);
      mkdirSync(evidence, { mode: 0o700 });
      directory = join(evidenceRoot, 'ipc-' + scope.runId);
      mkdirSync(directory, { mode: 0o700 });
      lease = createCentralDeviceLease({
        brainUrl: target.origin, token, deviceName: scope.serial, taskId: job.task_id, runId: scope.runId, runSeconds: 570,
      });
      try {
        await lease.acquire();
        local = 'unknown';
        const deviceLock = utf8(await controllerCall('lock-acquire-new', scope.owner));
        use(deviceLock.split('\n').filter(line => line.startsWith('lock=')).join('') === `lock=acquired owner=${scope.owner}`);
        local = 'held';
        await hold();
        leaf = await startCollectionLeafProducer({
          directory: join(evidence, 'leaves'), policy, serial: scope.serial,
          deadlineMs: cleanupDeadline, admissionDeadlineMs: cleanupDeadline, env, assertAdmission: hold,
        });
        ipc = await serveStandaloneBilibiliVerify({
          scope: { ...scope, deadlineMs: deadline }, directory, evidenceDirectory: evidence,
          assertAuthority: hold, readOwnVideo: createBilibiliNativeReader(makeDevice()),
        });
        return { connectionPath: ipc.connectionPath, close };
      } catch (error) {
        await close();
        throw error;
      }
    },
    async runAgent({ connectionPath }) {
      use(connectionPath === ipc?.connectionPath && !started);
      started = new Date().toISOString();
      try {
        await callStandaloneSkillTool(connectionPath, 'verify_existing', {}, { timeoutMs: Math.min(360000, deadline - Date.now()) });
      } finally {
        ended = new Date().toISOString();
      }
    },
    async verifyBusiness({ taskId, runId }) {
      use(taskId === job.task_id && runId === scope.runId && started && ended);
      await hold();
      const manifest = readBilibiliVerifyReceipt(evidence, scope);
      const response = await request('workflow-foundation/standalone/attest-bilibili-verify-existing', {
        machine_id: job.machine_id, task_id: taskId, run_id: runId, manifest, started_at: started, ended_at: ended,
      });
      use(response.attested === true && response.evidence === 'sha256:' + digest(manifest));
      return { summary: '指定 B 站既有私密视频的本人 UID、可见范围和完整播放已读回', evidence: [response.evidence] };
    },
  };
}
