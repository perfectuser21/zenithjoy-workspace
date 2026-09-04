/**
 * phonectl.test.js — OpenClaw 信号桥·件3 phonectl CLI 单测
 *
 * 起一个本地 mock HTTP server 顶替中台设备指令桥（件2 POST /api/devices/:agentId/actions），
 * 断言 phonectl 对 8 个 action 的参数映射、鉴权头、超时透传、错误码退出码正确。
 *
 * 运行: node --test scripts/openclaw/__tests__/phonectl.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../phonectl.sh');
const AGENT_ID = '11111111-1111-4111-8111-111111111111';

function startMockServer(handler) {
  return new Promise((resolveServer) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { /* ignore */ }
        handler(req, res, parsed);
      });
    });
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

function stopServer(server) {
  return new Promise((res) => server.close(() => res()));
}

// 必须用异步 spawn，不能用 spawnSync：mock server 跟测试跑在同一个 Node 进程/事件循环里，
// spawnSync 会同步阻塞整个事件循环等子进程退出——server 收不到子进程发来的请求，
// 子进程（curl）永远等不到响应，死锁到 timeout。spawn 是异步的，事件循环能继续跑，
// server 才能正常处理请求。
function runPhonectl(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn('bash', [SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

test('tap 参数映射：x/y 正确进请求体，Authorization 头正确，200 ok:true → exit 0', async () => {
  let capturedPath, capturedAuth, capturedBody;
  const server = await startMockServer((req, res, body) => {
    capturedPath = req.url;
    capturedAuth = req.headers.authorization;
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', outcome: 'completed' } }));
  });
  const { status, stdout } = await runPhonectl([AGENT_ID, 'tap', '540', '1200'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'test-token-abc',
  });
  await stopServer(server);
  assert.equal(status, 0);
  assert.equal(capturedPath, `/api/devices/${AGENT_ID}/actions`);
  assert.equal(capturedAuth, 'Bearer test-token-abc');
  assert.deepEqual(capturedBody, { x: 540, y: 1200, action: 'tap' });
  assert.match(stdout, /"ok":true/);
});

test('swipe 带 durationMs 时正确解析，不带时用默认（不发 durationMs 字段）', async () => {
  let capturedBody;
  const server = await startMockServer((req, res, body) => {
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true } }));
  });
  await runPhonectl([AGENT_ID, 'swipe', '10', '20', '30', '40'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.deepEqual(capturedBody, { x1: 10, y1: 20, x2: 30, y2: 40, action: 'swipe' });
});

test('swipe 带显式 durationMs', async () => {
  let capturedBody;
  const server = await startMockServer((req, res, body) => {
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true } }));
  });
  await runPhonectl([AGENT_ID, 'swipe', '10', '20', '30', '40', '500'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.deepEqual(capturedBody, { x1: 10, y1: 20, x2: 30, y2: 40, durationMs: 500, action: 'swipe' });
});

test('type 文本原样透传（含空格）', async () => {
  let capturedBody;
  const server = await startMockServer((req, res, body) => {
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true } }));
  });
  await runPhonectl([AGENT_ID, 'type', '人工智能训练师'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.deepEqual(capturedBody, { text: '人工智能训练师', action: 'type' });
});

test('key 只认 back|home，其他值本地直接拒绝(不发请求) exit 2', async () => {
  const { status, stderr } = await runPhonectl([AGENT_ID, 'key', 'menu'], {
    ZENITHJOY_API_BASE: 'http://127.0.0.1:1',
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  assert.equal(status, 2);
  assert.match(stderr, /back\|home/);
});

test('launch pkg 透传', async () => {
  let capturedBody;
  const server = await startMockServer((req, res, body) => {
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true } }));
  });
  await runPhonectl([AGENT_ID, 'launch', 'com.ss.android.ugc.aweme'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.deepEqual(capturedBody, { pkg: 'com.ss.android.ugc.aweme', action: 'launch' });
});

test('device_info / screenshot / tree_dump 无参数动作请求体只有 action', async () => {
  for (const action of ['device_info', 'screenshot', 'tree_dump']) {
    let capturedBody;
    const server = await startMockServer((req, res, body) => {
      capturedBody = body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true } }));
    });
    await runPhonectl([AGENT_ID, action], {
      ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
      ZENITHJOY_INTERNAL_TOKEN: 't',
    });
    await stopServer(server);
    assert.deepEqual(capturedBody, { action });
  }
});

test('--timeout-ms 与 --idempotency-key 正确进请求体', async () => {
  let capturedBody;
  const server = await startMockServer((req, res, body) => {
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true } }));
  });
  const ik = '22222222-2222-4222-8222-222222222222';
  await runPhonectl([AGENT_ID, 'tap', '1', '2', '--timeout-ms', '20000', '--idempotency-key', ik], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.deepEqual(capturedBody, { x: 1, y: 2, action: 'tap', timeoutMs: 20000, idempotencyKey: ik });
});

test('data.ok=false → 打印结果但 exit 非零（AI 循环能读到失败原因）', async () => {
  const server = await startMockServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: false, errorCode: 'COORD_OUT_OF_BOUNDS' } }));
  });
  const { status, stdout } = await runPhonectl([AGENT_ID, 'tap', '9999', '9999'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.notEqual(status, 0);
  assert.match(stdout, /COORD_OUT_OF_BOUNDS/);
});

test('504 超时：outcome:unknown 透传到 stdout，exit 非零', async () => {
  const server = await startMockServer((req, res) => {
    res.writeHead(504, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'DEVICE_TIMEOUT', message: '超时', outcome: 'unknown' }));
  });
  const { status, stdout } = await runPhonectl([AGENT_ID, 'tap', '1', '2'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.notEqual(status, 0);
  assert.match(stdout, /"outcome":"unknown"/);
});

test('缺 ZENITHJOY_INTERNAL_TOKEN → 本地直接拒绝(不发请求) exit 2', async () => {
  const { status, stderr } = await runPhonectl([AGENT_ID, 'tap', '1', '2'], {
    ZENITHJOY_API_BASE: 'http://127.0.0.1:1',
    ZENITHJOY_INTERNAL_TOKEN: '',
  });
  assert.equal(status, 2);
  assert.match(stderr, /ZENITHJOY_INTERNAL_TOKEN/);
});

test('agent_id 非 uuid 形状 → 本地直接拒绝 exit 2', async () => {
  const { status, stderr } = await runPhonectl(['not-a-uuid', 'tap', '1', '2'], {
    ZENITHJOY_API_BASE: 'http://127.0.0.1:1',
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  assert.equal(status, 2);
  assert.match(stderr, /uuid/);
});

test('未知 action → 本地直接拒绝 exit 2', async () => {
  const { status, stderr } = await runPhonectl([AGENT_ID, 'reboot'], {
    ZENITHJOY_API_BASE: 'http://127.0.0.1:1',
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  assert.equal(status, 2);
  assert.match(stderr, /未知 action/);
});

test('参数不足（tap 缺 y） → 本地直接拒绝 exit 2', async () => {
  const { status } = await runPhonectl([AGENT_ID, 'tap', '1'], {
    ZENITHJOY_API_BASE: 'http://127.0.0.1:1',
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  assert.equal(status, 2);
});

test('400 UNKNOWN_ACTION 等非 2xx 响应：打印 body 且 exit 非零', async () => {
  const server = await startMockServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'AGENT_NOT_FOUND', message: 'agent 不存在' }));
  });
  const { status, stdout } = await runPhonectl([AGENT_ID, 'tap', '1', '2'], {
    ZENITHJOY_API_BASE: `http://127.0.0.1:${server.address().port}`,
    ZENITHJOY_INTERNAL_TOKEN: 't',
  });
  await stopServer(server);
  assert.notEqual(status, 0);
  assert.match(stdout, /AGENT_NOT_FOUND/);
});
