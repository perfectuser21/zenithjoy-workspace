import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

const moduleUrl = new URL('../payment-public-check.mjs', import.meta.url).href;
const shellPath = new URL('../smoke/payment-smoke.sh', import.meta.url).pathname;
const sha = '1111111111111111111111111111111111111111';
const childSource = `
const { runPaymentProbe, probeExitCode } = await import(process.argv[1]);
const result = await runPaymentProbe({ baseUrl: process.argv[2], expectedSha: process.argv[3], timeoutMs: 300 });
console.log(JSON.stringify(result));
process.exitCode = probeExitCode(result);
`;

async function child(baseUrl, expectedSha = sha) {
  const p = spawn(process.execPath, ['--input-type=module', '-e', childSource, moduleUrl, baseUrl, expectedSha], {
    env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  p.stdout.on('data', b => { stdout += b; });
  p.stderr.on('data', b => { stderr += b; });
  const [code] = await once(p, 'exit');
  assert.equal(stderr, '', stderr);
  return { code, result: JSON.parse(stdout) };
}

async function fixture(t, callback, health = { status: 'ok', build: { sha } }) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    calls.push({ path: req.url, method: req.method, headers: req.headers, body });
    if (req.url === '/api/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(health));
    } else callback(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls };
}

test('missing base or expected SHA is not_verified and never claims signature rejection', async () => {
  const missing = spawn('/bin/bash', [shellPath, '--probe'], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  missing.stdout.on('data', b => { output += b; });
  const [exit] = await once(missing, 'exit');
  assert.equal(exit, 2, 'missing probe configuration must not exit as a successful verification');
  assert.equal(JSON.parse(output).state, 'not_verified');
  for (const [base, expected] of [['', sha], ['https://staging-autopilot.zenjoymedia.media', '']]) {
    const r = await child(base, expected);
    assert.equal(r.code, 2);
    assert.equal(r.result.state, 'not_verified');
    assert.equal(r.result.signature_rejection_verified, false);
  }
});

test('a different deployed SHA fails before any callback request', async t => {
  const f = await fixture(t, () => assert.fail('callback must not run'), { status: 'ok', build: { sha: '2'.repeat(40) } });
  const r = await child(f.baseUrl);
  assert.equal(r.code, 1);
  assert.equal(r.result.reason, 'staging_sha_mismatch');
  assert.deepEqual(f.calls.map(c => c.path), ['/api/health']);
});

test('UNKNOWN_PROVIDER is explicitly not_verified, not a missing route or verified signature', async t => {
  const f = await fixture(t, (_, res) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"code":"UNKNOWN_PROVIDER"}'); });
  const r = await child(f.baseUrl);
  assert.equal(r.code, 2);
  assert.equal(r.result.reason, 'provider_not_enabled');
  assert.equal(r.result.signature_rejection_verified, false);
});

test('only application 403 SIGNATURE_INVALID verifies unsigned rejection for the exact SHA', async t => {
  const f = await fixture(t, (_, res) => { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"code":"SIGNATURE_INVALID"}'); });
  const r = await child(f.baseUrl);
  assert.equal(r.code, 0);
  assert.equal(r.result.state, 'verified');
  assert.equal(r.result.signature_rejection_verified, true);
  assert.equal(r.result.payment_business_verified, false);
  assert.equal(r.result.sha, sha);
  assert.deepEqual(f.calls.map(c => [c.path, c.method]), [['/api/health', 'GET'], ['/api/payment/callback/wechat', 'POST']]);
  assert.equal(f.calls[1].body, '{}');
  assert.equal(f.calls[1].headers['wechatpay-signature'], undefined);
  assert.equal(f.calls[1].headers.authorization, undefined);
});

for (const [name, status, type, body] of [
  ['HTML WAF 403', 403, 'text/html', '<h1>Forbidden</h1>'],
  ['unrelated JSON 403', 403, 'application/json', '{"code":"ACCESS_DENIED"}'],
  ['missing route', 404, 'text/html', 'Cannot POST'],
  ['unsigned acceptance', 200, 'application/json', '{"code":"SUCCESS"}'],
  ['rate limit', 429, 'application/json', '{"code":"RATE_LIMITED"}'],
  ['server failure', 500, 'application/json', '{}'],
]) test(`${name} cannot become verified`, async t => {
  const f = await fixture(t, (_, res) => { res.writeHead(status, { 'Content-Type': type }); res.end(body); });
  const r = await child(f.baseUrl);
  assert.equal(r.code, 1);
  assert.equal(r.result.state, 'failed');
  assert.equal(r.result.signature_rejection_verified, false);
});

test('callback redirects are rejected without requesting their target', async t => {
  let redirected = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/redirect-target') redirected++;
    res.writeHead(307, { Location: '/redirect-target' }); res.end();
  });
  const r = await child(f.baseUrl);
  assert.equal(r.code, 1);
  assert.equal(redirected, 0);
  assert.equal(f.calls.length, 2);
});

test('a hanging HTTP callback has a finite timeout and fails', async t => {
  const f = await fixture(t, () => {});
  const r = await child(f.baseUrl);
  assert.equal(r.code, 1);
  assert.equal(r.result.reason, 'request_failed');
});

test('credentials, query, fragment and path are rejected before contacting the origin', async t => {
  const f = await fixture(t, () => assert.fail('no callback expected'));
  for (const base of [f.baseUrl + '/other', f.baseUrl + '?next=other', f.baseUrl + '#fragment', f.baseUrl.replace('://', '://user:pass@')]) {
    const r = await child(base);
    assert.equal(r.code, 1);
    assert.equal(r.result.reason, 'invalid_origin');
  }
  assert.equal(f.calls.length, 0);
});
