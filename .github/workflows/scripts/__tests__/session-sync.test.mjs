import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = fileURLToPath(new URL('../../../../scripts/sessions/sync-from-xian-rog.sh', import.meta.url));
function runSync({ ghFailure = 'none', missingFiles = false, curlExit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'session-sync-test-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // All external writes, device reads and notification transport are fixtures.
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nfor arg do [ "$arg" = "exit 0" ] && exit 0; done\n[ "$SYNC_MISSING_FILES" = true ] && exit 1\nprintf \'[{"name":"sessionid","value":"fixture"}]\\n\'\n', { mode: 0o755 });
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\n[ "$1" = secret ] && [ "$2" = set ] || exit 99\ncat >/dev/null\n[ "$SYNC_GH_FAILURE" = all ] && exit 1\ncase "$3" in *_SUB_1) [ "$SYNC_GH_FAILURE" = partial ] && exit 1;; esac\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit "$SYNC_CURL_EXIT"\n', { mode: 0o755 });
    return spawnSync('bash', [script, 'fixture-device'], { cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
        SYNC_GH_FAILURE: ghFailure, SYNC_MISSING_FILES: String(missingFiles), SYNC_CURL_EXIT: String(curlExit) } });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const [name, options] of [
  ['all secret writes fail', { ghFailure: 'all' }],
  ['some secret writes fail', { ghFailure: 'partial' }],
  ['all remote session files are absent', { missingFiles: true }],
]) test(`session sync exits nonzero when ${name}`, () => {
  const result = runSync(options);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /失败/);
});

test('session sync exits nonzero and does not claim delivery when Bark fails', () => {
  const result = runSync({ curlExit: 22 });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Bark 通知已发/);
});

test('session sync succeeds when all writes and alert delivery succeed', () => {
  const result = runSync();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /完成: 32 成功  0 失败/);
});
