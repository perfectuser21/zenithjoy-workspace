import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory } from './device-epoch-fence-files.mjs';
import { canonical } from './device-epoch-fence-reference.mjs';
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
