import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This directory is already run by the L3 CI shard glob. Keep the complete
// Python safety regression suite in that gate without adding device access.
test('WeChat foreground display and popup safety regressions', () => {
  const service = fileURLToPath(new URL('../../wechat-phone-controller/', import.meta.url));
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', `${service}tests`, '-v'], {
    env: { ...process.env, PYTHONPATH: service },
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
