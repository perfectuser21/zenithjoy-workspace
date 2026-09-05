import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../adb-controller-bridge.sh');
const AGENT_ID = 'e017953c-bc65-47e0-913e-a2ed5eb54993';
const TENANT_ID = '455a8ca9-5f63-4286-83ce-c5cca04cfd58';

function makeProfilesFile(dir) {
  const p = join(dir, 'profiles.json');
  writeFileSync(p, JSON.stringify({
    'test-profile': { agent_id: AGENT_ID, tenant_id: TENANT_ID },
  }));
  return p;
}

function startMockServer(handler) {
  return new Promise((resolveStart) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => resolveStart(server));
  });
}

function runBridge(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn('bash', [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

test('缺少 --profile 参数：exit 2，不发任何请求', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const r = await runBridge(['preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('未知 profile：exit 2，报 unknown profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const r = await runBridge(['--profile', 'nope', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown profile/);
  rmSync(dir, { recursive: true, force: true });
});

test('preflight：device_info 成功 + 有 active burner session → account_verified=true，call_state=unknown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const server = await startMockServer((req, res, body) => {
    if (req.url === `/api/devices/${AGENT_ID}/actions`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', data: { model: 'MAA-AN00', manufacturer: 'HONOR', androidVersion: '15', agentVersion: '2.1.48' }, outcome: 'completed' } }));
      return;
    }
    if (req.url === '/api/agent/burner/sessions') {
      assert.equal(req.headers['x-tenant-id'], TENANT_ID);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { sessions: [
        { agent_id: AGENT_ID, platform: 'douyin', role: 'burner', status: 'active', account_label: 'test-burner' },
      ] } }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.account_verified, true);
  assert.equal(out.call_state, 'unknown');
  assert.equal(out.model, 'MAA-AN00');
  assert.ok(out.warnings.some((w) => w.includes('call_state')));
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('preflight：无 active session → account_verified=false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const server = await startMockServer((req, res) => {
    if (req.url === `/api/devices/${AGENT_ID}/actions`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'launcher', data: { model: 'MAA-AN00' }, outcome: 'completed' } }));
      return;
    }
    if (req.url === '/api/agent/burner/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { sessions: [
        { agent_id: AGENT_ID, platform: 'douyin', role: 'burner', status: 'needs_rebind' },
      ] } }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.account_verified, false);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('preflight：device_info 失败 → blocked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const server = await startMockServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'NOT_CONNECTED' }));
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'DEVICE_UNREACHABLE');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
