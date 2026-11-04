import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

const script = fileURLToPath(new URL('../../../../scripts/sessions/sync-from-xian-rog.sh', import.meta.url));
const realCurl = spawnSync('bash', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
function curlUrlStatus(url) {
  // Only file transport is enabled: HTTPS is parsed but can never reach a server.
  return spawnSync(realCurl, ['--proto', '=file', '--url', url, '--silent', '--output', '/dev/null']).status;
}
function runSync({ ghFailure = 'none', missingFiles = false, curlExit = 0,
  cookieJson = '[{"name":"sessionid","value":"fixture"}]' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'session-sync-test-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // All external writes, device reads and notification transport are fixtures.
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nfor arg do [ "$arg" = "exit 0" ] && exit 0; done\n[ "$SYNC_MISSING_FILES" = true ] && exit 1\nprintf \'%s\\n\' "$SYNC_COOKIE_JSON"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\n[ "$1" = secret ] && [ "$2" = set ] || exit 99\nprintf \'%s\\n\' "$3" >> "$SYNC_GH_CALLS"\npython3 -c \'import sys,json,os;raw=sys.stdin.read();open(os.environ["SYNC_GH_PAYLOADS"],"a").write(json.dumps(raw)+"\\n")\'\n[ "$SYNC_GH_FAILURE" = all ] && exit 1\ncase "$3" in *_SUB_1) [ "$SYNC_GH_FAILURE" = partial ] && exit 1;; esac\nexit 0\n', { mode: 0o755 });
    // Keep real curl URL parsing while replacing notification transport. Raw
    // spaces produce exit 3; an encoded HTTPS URL reaches the disabled protocol
    // check (exit 1), after which the fixture supplies delivery success/failure.
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\nfor last_arg do :; done\nprintf \'%s\' "$last_arg" > "$SYNC_CURL_URL"\n"$SYNC_REAL_CURL" --proto =file --url "$last_arg" --silent --output /dev/null\n[ "$?" = 1 ] || exit 3\nexit "$SYNC_CURL_EXIT"\n', { mode: 0o755 });
    const calls = join(root, 'secret-writes');
    const payloads = join(root, 'secret-payloads');
    const curlUrl = join(root, 'notification-url');
    writeFileSync(calls, '');
    writeFileSync(payloads, '');
    const result = spawnSync('bash', [script, 'fixture-device'], { cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
        SYNC_GH_FAILURE: ghFailure, SYNC_MISSING_FILES: String(missingFiles), SYNC_CURL_EXIT: String(curlExit),
        SYNC_COOKIE_JSON: cookieJson, SYNC_GH_CALLS: calls, SYNC_GH_PAYLOADS: payloads,
        SYNC_REAL_CURL: realCurl, SYNC_CURL_URL: curlUrl } });
    const readLines = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    return { ...result, writes: readLines(calls), payloads: readLines(payloads).map(line => JSON.parse(JSON.parse(line))),
      notificationUrl: readFileSync(curlUrl, 'utf8') };
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

test('session sync encodes Bark paths and succeeds when all writes and alert delivery succeed', () => {
  assert.equal(curlUrlStatus('https://fixture.invalid/key/title/body with spaces?group=ZenithJoy'), 3);
  assert.equal(curlUrlStatus('https://fixture.invalid/key/title/body%20with%20spaces?group=ZenithJoy'), 1);
  const result = runSync();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /完成: 32 成功  0 失败/);
  assert.equal(result.writes.length, 32);
  assert.doesNotMatch(result.notificationUrl, /\s/);
  const url = new URL(result.notificationUrl);
  assert.equal(url.hostname, 'api.day.app');
  assert.equal(url.pathname.split('/').length, 4);
  assert.equal(decodeURIComponent(url.pathname.split('/')[2]), 'Session已同步✅');
  assert.match(decodeURIComponent(url.pathname.split('/')[3]), /DOUYIN MAIN\(1\)/);
  assert.equal(url.searchParams.get('group'), 'ZenithJoy');
});

test('session sync writes exactly the Secret names consumed by the actual health workflow', () => {
  const workflow = YAML.parse(readFileSync(new URL('../../session-health-check.yml', import.meta.url), 'utf8'));
  const env = workflow.jobs['check-sessions'].steps.find(step => step.name === 'Run health check').env;
  const expected = Object.entries(env).filter(([name]) => /^[A-Z]+_(?:COOKIES|SUB_[123])$/.test(name))
    .map(([, value]) => value.match(/^\$\{\{\s*secrets\.([A-Z_0-9]+)\s*\}\}$/)?.[1]);
  assert.equal(expected.length, 32);
  assert.ok(expected.every(Boolean));
  const result = runSync();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes.sort(), expected.sort());
});

test('session sync accepts Playwright storageState and preserves cookies plus origins in each Secret', () => {
  const state = { cookies: [{ name: 'sessionid', value: 'fixture', domain: '.fixture.invalid', path: '/' }],
    origins: [{ origin: 'https://fixture.invalid', localStorage: [{ name: 'state', value: 'keep-me' }] }] };
  const result = runSync({ cookieJson: JSON.stringify(state) });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.payloads.length, 32);
  assert.ok(result.payloads.every(payload => JSON.stringify(payload) === JSON.stringify(state)));
});

for (const [name, cookieJson] of [
  ['null', 'null'], ['object', '{}'], ['string', '"cookies"'], ['number', '1'],
  ['empty array', '[]'], ['malformed JSON', '[invalid'], ['blank JSON', '   '],
  ['null entry', '[null]'], ['string entry', '["cookie"]'], ['empty entry', '[{}]'],
  ['missing value', '[{"name":"sessionid"}]'],
  ['empty name', '[{"name":"","value":"fixture"}]'],
  ['nonstring name', '[{"name":1,"value":"fixture"}]'],
  ['nonstring value', '[{"name":"sessionid","value":1}]'],
  ['null value', '[{"name":"sessionid","value":null}]'],
  ['invalid entry after a valid cookie', '[{"name":"sessionid","value":"fixture"},null]'],
  ['storageState with empty cookies', '{"cookies":[],"origins":[]}'],
  ['storageState with invalid cookie', '{"cookies":[null],"origins":[]}'],
]) test(`session sync rejects ${name} before any Secret write`, () => {
  const result = runSync({ cookieJson });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.writes.length, 0, 'invalid session data must not overwrite existing Secrets');
  assert.match(result.stdout, /完成: 0 成功  32 失败/);
});
