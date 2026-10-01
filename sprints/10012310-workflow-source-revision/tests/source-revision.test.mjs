import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('native entry verifies producer source and existing receipts', async () => {
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  const execute = promisify(execFile);
  const source = await execute('bash', ['.github/workflows/scripts/smoke/workflow-source-revision-smoke.sh'],
    { cwd, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  expect(source.stdout).toMatch(/(?:fail 0|# fail 0)/);
  const receipts = await execute(process.execPath, ['--test',
    'services/phone-adb-controller/__tests__/workflow-result.test.mjs',
    'services/phone-adb-controller/__tests__/workflow-result-span.test.mjs',
    'services/phone-adb-controller/__tests__/drift-check.test.mjs'],
  { cwd, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  expect(receipts.stdout).toMatch(/(?:fail 0|# fail 0)/);
}, 100000);
