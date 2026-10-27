#!/usr/bin/env node
// 独立维护入口；只接受正式维护Task，不接受调用者提供scope或停止布尔。
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export {parseQualificationFailure} from './qualification-maintenance-evidence.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function maintenanceMain(argv) {
  const [verb, flag, taskId, ...extra] = argv;
  if (!['preflight', 'close', 'readback'].includes(verb) || extra.length
      || flag !== '--maintenance-task-id' || !uuid.test(taskId || '')) {
    return {exit_code: 2, result: {ok: false, code: 'MAINTENANCE_TASK_REQUIRED'}};
  }
  try {
    const {runMaintenance} = await import('./qualification-maintenance-service.mjs');
    return {exit_code: 0, result: await runMaintenance({verb, taskId})};
  } catch (error) {
    const code = /^MAINTENANCE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'MAINTENANCE_EXECUTION_UNKNOWN';
    return {exit_code: 1, result: {ok: false, code}};
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await maintenanceMain(process.argv.slice(2));
  process.stdout.write(JSON.stringify(outcome.result) + '\n');
  process.exitCode = outcome.exit_code;
}
