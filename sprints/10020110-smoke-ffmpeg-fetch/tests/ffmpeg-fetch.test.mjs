import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('native entry verifies bounded signed ffmpeg acquisition and real tools', async () => {
  const execute = promisify(execFile);
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await execute('bash', ['.github/workflows/scripts/smoke/ci-ffmpeg-fetch-smoke.sh'],
    { cwd, timeout: 30000, maxBuffer: 1024 * 1024 });
  expect(result.stdout).toMatch(/(?:fail 0|# fail 0)/);
}, 35000);
