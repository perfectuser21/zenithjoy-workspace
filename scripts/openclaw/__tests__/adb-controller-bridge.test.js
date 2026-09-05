import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../adb-controller-bridge.sh');
const AGENT_ID = 'e017953c-bc65-47e0-913e-a2ed5eb54993';
const TENANT_ID = '455a8ca9-5f63-4286-83ce-c5cca04cfd58';

function makeProfilesFile(dir, extra) {
  const p = join(dir, 'profiles.json');
  writeFileSync(p, JSON.stringify({
    'test-profile': { agent_id: AGENT_ID, tenant_id: TENANT_ID },
    ...extra,
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
  try {
    const profilesFile = makeProfilesFile(dir);
    const r = await runBridge(['preflight'], {
      PROFILES_FILE: profilesFile,
      ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('未知 profile：exit 2，报 unknown profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const r = await runBridge(['--profile', 'nope', 'preflight'], {
      PROFILES_FILE: profilesFile,
      ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown profile/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('profile 名称含非法字符（能查到 agent_id 但字符集非法）：exit 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  try {
    const profilesFile = makeProfilesFile(dir, {
      '../evil': { agent_id: AGENT_ID, tenant_id: TENANT_ID },
    });
    const r = await runBridge(['--profile', '../evil', 'preflight'], {
      PROFILES_FILE: profilesFile,
      ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /profile 名称非法/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight：device_info 成功 + 有 active burner session → account_verified=true，call_state=unknown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res, body) => {
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
    assert.equal(out.sessions_check_ok, true);
    assert.equal(out.call_state, 'unknown');
    assert.equal(out.model, 'MAA-AN00');
    assert.ok(out.warnings.some((w) => w.includes('call_state')));
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight：无 active session → account_verified=false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
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
    assert.equal(out.sessions_check_ok, true);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight：device_info 失败 → blocked，detail 带上 phonectl 的真实 stderr', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
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
    assert.match(out.detail, /NOT_CONNECTED/);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight：sessions 接口返回非 200（503）→ account_verified=false，sessions_check_ok=false，带 warning，exit 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      if (req.url === `/api/devices/${AGENT_ID}/actions`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'launcher', data: { model: 'MAA-AN00' }, outcome: 'completed' } }));
        return;
      }
      if (req.url === '/api/agent/burner/sessions') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'UPSTREAM_DOWN' }));
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
    assert.equal(out.account_verified, false);
    assert.equal(out.sessions_check_ok, false);
    assert.ok(out.warnings.some((w) => w.includes('burner sessions') && w.includes('503')));
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight：sessions 接口返回 200 但 body 非法 JSON → 不 crash，account_verified=false + warning，exit 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      if (req.url === `/api/devices/${AGENT_ID}/actions`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'launcher', data: { model: 'MAA-AN00' }, outcome: 'completed' } }));
        return;
      }
      if (req.url === '/api/agent/burner/sessions') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not json');
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
    assert.ok(r.stdout.trim().length > 0, 'stdout 不应为空');
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.account_verified, false);
    assert.equal(out.sessions_check_ok, false);
    assert.ok(out.warnings.some((w) => w.includes('burner sessions')));
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lock-acquire：首次获取成功', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.acquired, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-acquire：同一 run_id 重入返回 already_owned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.already_owned, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-acquire：不同 run_id 冲突 → LOCKED，exit 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-2'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.errorCode, 'LOCKED');
    assert.equal(out.owner, 'run-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-release：非 owner 释放 → NOT_OWNER，exit 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const r = await runBridge(['--profile', 'test-profile', 'lock-release', 'run-2'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.errorCode, 'NOT_OWNER');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-release：owner 释放成功，release 后 lock-status 显示 locked=false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const rel = await runBridge(['--profile', 'test-profile', 'lock-release', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(rel.status, 0);
    const status = await runBridge(['--profile', 'test-profile', 'lock-status'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const out = JSON.parse(status.stdout);
    assert.equal(out.locked, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-acquire：锁文件损坏（非法 JSON）→ 视为无锁，直接获取成功', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const profileDir = join(evDir, 'test-profile');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, '.lock.json'), 'not json garbage');
    const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.acquired, true);
    const lockContent = JSON.parse(readFileSync(join(profileDir, '.lock.json'), 'utf8'));
    assert.equal(lockContent.owner, 'run-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-status：锁文件损坏（非法 JSON）→ locked=false，带 warning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const profileDir = join(evDir, 'test-profile');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, '.lock.json'), 'not json garbage');
    const r = await runBridge(['--profile', 'test-profile', 'lock-status'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.locked, false);
    assert.ok(out.warning && out.warning.includes('损坏'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-acquire：同一 run_id 重入会刷新 TTL（acquired_at_epoch 变新）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const profileDir = join(evDir, 'test-profile');
    await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const firstLock = JSON.parse(readFileSync(join(profileDir, '.lock.json'), 'utf8'));
    await new Promise((r) => setTimeout(r, 1100));
    const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.already_owned, true);
    const secondLock = JSON.parse(readFileSync(join(profileDir, '.lock.json'), 'utf8'));
    assert.ok(secondLock.acquired_at_epoch > firstLock.acquired_at_epoch,
      `期望刷新后的 acquired_at_epoch(${secondLock.acquired_at_epoch}) > 首次(${firstLock.acquired_at_epoch})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('lock-acquire：过期孤儿锁（TTL=0）允许抢占', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-2'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
      OPENCLAW_LOCK_TTL_SECONDS: '0',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.acquired, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});
