import { mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureRecordRoot, privateDirectory } from './device-epoch-fence-files.mjs';
import { bytes, canonical, digest, readPrivatePolicy } from './device-epoch-fence-reference.mjs';
import { hostOperation } from './device-epoch-fence-transport.mjs';
import {
  createYueshengDaemonBinding, readYueshengHostObservation, readYueshengInstalledCandidate,
  readYueshengMigrationAuthority, yueshengMaintenanceTask,
} from './device-epoch-fence-yuesheng-host-reads.mjs';
import { runYueshengMigration } from './device-epoch-fence-yuesheng-migration.mjs';
import { planYueshengMigration } from './device-epoch-fence-yuesheng-plan.mjs';
import { yueshengMigrationRoute as route } from './device-epoch-fence-yuesheng-readback.mjs';

function requireCondition(condition, reason) {
  if (condition) return;
  const code = 'YUESHENG_MIGRATION_' + reason;
  throw Object.assign(new Error(code), { code });
}

export function createYueshengRouteOperator({ journalRoot, daemons }, { bindDaemon, send = hostOperation }) {
  const root = privateDirectory(journalRoot);
  const endpoints = { disconnect: ['old', route.old_endpoint], connect: ['next', route.new_endpoint] };
  return async ({ operation, scope, assertAuthority }) => {
    requireCondition(Object.hasOwn(endpoints, operation) && typeof assertAuthority === 'function', 'ACTION_SCOPE');
    const [name, endpoint] = endpoints[operation];
    const expectedScope = { endpoint, serial: route.transport_serial };
    requireCondition(canonical(scope) === canonical(expectedScope) && daemons[name]?.endpoint === endpoint, 'ACTION_SCOPE');
    const daemon = structuredClone(daemons[name]);
    const readAuthority = async () => {
      await assertAuthority();
      requireCondition(canonical(await bindDaemon(daemon)) === canonical(daemon), 'DAEMON_IDENTITY');
      const { lease } = await assertAuthority();
      return { scope: expectedScope, authorized_action: operation, lease_until: lease.expires_at };
    };
    return send({ operation, scope: expectedScope, readAuthority,
      directory: mkdtempSync(join(root, operation + '-wire-')) });
  };
}

export async function planYueshengOnMacStudio({ taskId, pendingActionId, sourceCommit, journalRoot }) {
  const root = privateDirectory(journalRoot);
  let binding;
  return planYueshengMigration({ taskId, pendingActionId, sourceCommit }, {
    async readBefore(expectedLease) {
      binding ??= await createYueshengDaemonBinding({ sourceCommit });
      return readYueshengHostObservation({ phase: 'before', journalRoot: root, expectedLease,
        daemons: binding.daemons }, { bindDaemon: binding.bindDaemon });
    },
  });
}

export async function executeYueshengOnMacStudio({ plan, journalRoot, withDeviceGuard }) {
  requireCondition(plan?.task_id === yueshengMaintenanceTask && typeof withDeviceGuard === 'function', 'EXECUTION_SCOPE');
  const root = privateDirectory(journalRoot);
  const { source_commit: sourceCommit, task_id: taskId, pending_action_id: pendingActionId, lease: expectedLease } = plan;
  const { daemons, bindDaemon } = await createYueshengDaemonBinding({ sourceCommit });
  return runYueshengMigration({ plan, journalRoot: root, io: {
    withDeviceGuard,
    readAuthority: () => readYueshengMigrationAuthority({ taskId, pendingActionId }),
    readCandidate: () => readYueshengInstalledCandidate(sourceCommit),
    observe: phase => readYueshengHostObservation({ phase, journalRoot: root, daemons, expectedLease }, { bindDaemon }),
    operate: createYueshengRouteOperator({ journalRoot: root, daemons }, { bindDaemon }),
  } });
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationFiles = ['execution', 'host-reads', 'local-lock', 'migration', 'plan', 'readback']
  .map(suffix => 'device-epoch-fence-yuesheng-' + suffix + '.mjs')
  .concat('yuesheng-adb-daemon-binding.py');

async function readThisCandidate(sourceCommit) {
  const base = join(userInfo().homedir, '.local/share/zenithjoy');
  requireCondition(/^[a-f0-9]{40}$/.test(sourceCommit ?? '')
    && here === join(base, 'phone-candidates', sourceCommit, 'runtime'), 'EXECUTION_SOURCE');
  const { manifest } = await readYueshengInstalledCandidate(sourceCommit);
  for (const name of migrationFiles) {
    const entries = manifest.files?.filter(row => row.deployed_path === name);
    requireCondition(entries?.length === 1
      && entries[0].path === 'services/phone-adb-controller/' + name
      && entries[0].content_sha256 === digest(bytes(join(here, name))), 'EXECUTION_SOURCE');
  }
  return { manifest, journalRoot: join(base, 'device-epoch-migrations', route.physical_serial) };
}

async function main([operation, sourceCommit, input, ...extra]) {
  requireCondition(extra.length === 0 && input && ['plan', 'execute'].includes(operation), 'USAGE');
  const { manifest, journalRoot } = await readThisCandidate(sourceCommit);
  ensureRecordRoot(journalRoot);
  if (operation === 'plan') {
    return planYueshengOnMacStudio({ taskId: yueshengMaintenanceTask, pendingActionId: input, sourceCommit, journalRoot });
  }
  const { plan, plan_sha256: planSha } = JSON.parse(readPrivatePolicy(resolve(input)));
  requireCondition(plan?.source_commit === sourceCommit && plan.task_id === yueshengMaintenanceTask
    && planSha === digest(plan), 'EXECUTION_PLAN');
  const { createYueshengLocalDeviceGuard } = await import('./device-epoch-fence-yuesheng-local-lock.mjs');
  const withDeviceGuard = createYueshengLocalDeviceGuard({
    controllerPath: join(here, 'douyin-phone-adb'), manifest, owner: plan.task_id,
  });
  return executeYueshengOnMacStudio({ plan, journalRoot, withDeviceGuard });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(await main(process.argv.slice(2))) + '\n');
  } catch (error) {
    const code = /^YUESHENG_MIGRATION_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'YUESHENG_MIGRATION_EXECUTION_FAILED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}
