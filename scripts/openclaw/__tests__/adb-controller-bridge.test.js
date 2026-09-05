import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
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

// 1x1 红色 PNG，base64（合法最小图片，供 snapshot 落盘断言用）
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('open-app：调用 phonectl launch 抖音包名', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let capturedBody = null;
    server = await startMockServer((req, res, body) => {
      capturedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'open-app'], {
      PROFILES_FILE: profilesFile, ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    assert.equal(capturedBody.action, 'launch');
    assert.equal(capturedBody.pkg, 'com.ss.android.ugc.aweme');
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.foregroundPkg, 'com.ss.android.ugc.aweme');
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshot-evidence：成功落盘 PNG 并返回路径+双分辨率', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, data: {
        imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664,
      }, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-001'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.captureWidth, 720);
    assert.equal(out.screenWidth, 1200);
    const written = readFileSync(out.path);
    assert.equal(written.toString('base64'), TINY_PNG_B64);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('snapshot-evidence：非法 EVIDENCE_ID 格式 → exit 2，不发请求', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'has space'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('snapshot-evidence：phonectl screenshot 失败 → 透传错误，不落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: false, errorCode: 'CAPTURE_FAILED', outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-002'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(existsSync(join(evDir, 'test-profile', 'snapshot-ev-002.png')), false);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

// 在合法 base64 中间插入非法字符（不属于 base64 字母表），破坏编码本身（Critical 1 复现用例）。
const CORRUPTED_ILLEGAL_CHARS_B64 = `${TINY_PNG_B64.slice(0, 10)}!@#${TINY_PNG_B64.slice(13)}`;

// 合法 base64（字符集合法、可正常解码），但解码出来的内容根本不是 PNG，末尾也没有
// 合法的 IEND chunk —— 用来模拟"base64 -d 退出码是 0 但内容被截断/破坏"的场景
// （Critical 2 复现用例：macOS/BSD 的 base64 在这种输入下不会报任何错误）。
const FAKE_TRUNCATED_PNG_B64 = Buffer.from(
  'this looks like it could be image bytes but it is not a real PNG and has no IEND chunk at the end at all'
).toString('base64');

test('snapshot-evidence：imageBase64 含非法字符（损坏的 base64）→ ok:false，不留垃圾文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, data: {
        imageBase64: CORRUPTED_ILLEGAL_CHARS_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664,
      }, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-corrupt-b64'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    const profileDir = join(evDir, 'test-profile');
    const leftoverFiles = existsSync(profileDir)
      ? readdirSync(profileDir).filter((f) => f.endsWith('.png') || f.includes('.tmp.'))
      : [];
    assert.deepEqual(leftoverFiles, [], `不应留下任何垃圾文件，实际发现: ${leftoverFiles.join(',')}`);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('snapshot-evidence：base64 可正常解码但内容没有合法 PNG IEND chunk（模拟网络截断）→ ok:false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, data: {
        imageBase64: FAKE_TRUNCATED_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664,
      }, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-truncated'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    const profileDir = join(evDir, 'test-profile');
    const leftoverFiles = existsSync(profileDir)
      ? readdirSync(profileDir).filter((f) => f.endsWith('.png') || f.includes('.tmp.'))
      : [];
    assert.deepEqual(leftoverFiles, [], `不应留下任何垃圾文件，实际发现: ${leftoverFiles.join(',')}`);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('snapshot-evidence：同一 evidence_id 先成功落盘，再用损坏数据调用 → 原文件内容不被销毁（原子写）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  let currentImageBase64 = TINY_PNG_B64;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, data: {
        imageBase64: currentImageBase64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664,
      }, outcome: 'completed' } }));
    });
    const { port } = server.address();

    const r1 = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-reuse'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r1.status, 0);
    const out1 = JSON.parse(r1.stdout);
    const filePath = out1.path;
    const originalContent = readFileSync(filePath);
    assert.equal(originalContent.toString('base64'), TINY_PNG_B64);

    currentImageBase64 = FAKE_TRUNCATED_PNG_B64;
    const r2 = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-reuse'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r2.status, 1);
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.ok, false);

    const afterContent = readFileSync(filePath);
    assert.deepEqual(afterContent, originalContent, '第二次损坏写入不能销毁第一次成功落盘的好文件');
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：动作成功 → 等待后截图存证，返回 action_ok', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let tapCalled = false, screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'tap') { tapCalled = true; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
      if (b.action === 'screenshot') {
        screenshotCalled = true;
        res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-1', '10'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    assert.ok(tapCalled); assert.ok(screenshotCalled);
    const out = JSON.parse(r.stdout);
    assert.equal(out.action_ok, true);
    assert.ok(out.path);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：动作失败 → 不截图，直接透传错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'screenshot') { screenshotCalled = true; }
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: false, errorCode: 'DEVICE_BUSY', outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-2'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    assert.equal(screenshotCalled, false);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('swipe-evidence：成功路径调用 swipe 再截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let capturedSwipeBody = null;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'swipe') { capturedSwipeBody = b; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
      if (b.action === 'screenshot') { res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } })); return; }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'swipe-evidence', '600', '2000', '600', '500', '400', 'ev-swipe-1', '10'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    assert.equal(capturedSwipeBody.x1, 600); assert.equal(capturedSwipeBody.durationMs, 400);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('back-evidence：成功路径调用 key back 再截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let capturedKeyBody = null;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'key') { capturedKeyBody = b; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
      if (b.action === 'screenshot') { res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } })); return; }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'back-evidence', 'ev-back-1', '10'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    // 注意：phonectl.sh 的 key action 把参数包成 {name:$n}，不是 {key:$n}
    // （见 phonectl.sh:91-96），这里断言实际字段名 name，而非计划文档里过时的 key。
    assert.equal(capturedKeyBody.name, 'back');
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：wait_ms 非数字（简单非法值）→ exit 2，不截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'screenshot') { screenshotCalled = true; }
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-illegal', 'abc'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
    assert.equal(screenshotCalled, false);
    assert.equal(existsSync(join(evDir, 'test-profile', 'snapshot-ev-tap-illegal.png')), false);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：wait_ms 命令注入 payload（awk system()）→ exit 2，不执行注入命令，不截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  const markerFile = join(tmpdir(), `openclaw-pwn-test-${process.pid}-${Date.now()}`);
  try {
    const profilesFile = makeProfilesFile(dir);
    let screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'screenshot') { screenshotCalled = true; }
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const injection = `800; system("touch ${markerFile}")`;
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-inject', injection], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
    assert.equal(screenshotCalled, false);
    assert.equal(existsSync(markerFile), false, '命令注入 payload 不应被执行，marker 文件不应存在');
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
    rmSync(markerFile, { force: true });
  }
});

test('tap-evidence：wait_ms 带前导零（"010"）→ exit 2，不按八进制静默算错，不截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'screenshot') { screenshotCalled = true; }
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-leadingzero', '010'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
    assert.equal(screenshotCalled, false);
    assert.match(r.stderr, /wait_ms 必须是非负整数/);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：wait_ms 带前导零且含 8（"008"）→ exit 2，不触发 bash 算术错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'screenshot') { screenshotCalled = true; }
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-octal8', '008'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 2);
    assert.equal(screenshotCalled, false);
    assert.match(r.stderr, /wait_ms 必须是非负整数/);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：wait_ms="0"（单独的合法零值）→ 正常工作，不被前导零校验误伤', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let tapCalled = false, screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'tap') { tapCalled = true; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
      if (b.action === 'screenshot') {
        screenshotCalled = true;
        res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-zero', '0'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    assert.ok(tapCalled); assert.ok(screenshotCalled);
    const out = JSON.parse(r.stdout);
    assert.equal(out.action_ok, true);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

test('tap-evidence：动作成功但截图失败 → exit 1，返回体带 action_ok:false + action_already_executed:true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let tapCalled = false, screenshotCalled = false;
    server = await startMockServer((req, res, body) => {
      const b = JSON.parse(body);
      if (b.action === 'tap') { tapCalled = true; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
      if (b.action === 'screenshot') { screenshotCalled = true; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: false, errorCode: 'CAPTURE_FAILED', outcome: 'completed' } })); return; }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-capfail', '10'], {
      PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 1);
    assert.ok(tapCalled); assert.ok(screenshotCalled);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.action_ok, false);
    assert.equal(out.action_already_executed, true);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(evDir, { recursive: true, force: true });
  }
});

for (const cmd of ['current-video-link', 'record-start', 'record-stop', 'record-status', 'record-extract-audio', 'ui-evidence']) {
  test(`${cmd}：本次范围不支持，exit 3`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acb-'));
    try {
      const profilesFile = makeProfilesFile(dir);
      const r = await runBridge(['--profile', 'test-profile', cmd], {
        PROFILES_FILE: profilesFile, ZENITHJOY_INTERNAL_TOKEN: 'tok',
      });
      assert.equal(r.status, 3);
      const out = JSON.parse(r.stdout);
      assert.equal(out.errorCode, 'UNSUPPORTED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
