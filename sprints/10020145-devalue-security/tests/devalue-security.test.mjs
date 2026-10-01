import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('native entry verifies patched devalue and actual Buffer serialization', async () => {
  const execute = promisify(execFile);
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await execute('bash', ['.github/workflows/scripts/smoke/devalue-security-smoke.sh'],
    { cwd, timeout: 65000, maxBuffer: 1024 * 1024 });
  expect(result.stdout).toMatch(/(?:fail 0|# fail 0)/);
}, 70000);
