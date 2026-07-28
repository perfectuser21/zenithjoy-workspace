import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerLeaseBrokerRoutes } from '../wechat-rpa';

// Sprint 0703-line04-desktop-lease-broker（补线 PR）：
// PR#1082 只写了 registerLeaseBrokerRoutes 函数本体，从未在任何真实 http.Server 上调用过——
// /api/agent/desktop-lease-broker/* 在真实 agent 进程里根本不存在。本测试证明：
// 1) 挂到任意 http.Server 上真的能收发请求（而不只是单元测试里直接调内部函数）
// 2) index.ts 的真实启动路径（startLocalDiscoveryServer）确实调用了它，防止再次悄悄漏线

describe('registerLeaseBrokerRoutes — 挂到真实 http.Server [BEHAVIOR]', () => {
  let server: http.Server | null = null;
  const PORT = 25301;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it('POST /api/agent/desktop-lease-broker/acquire 返回真实 granted 字段（不是 404）', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    registerLeaseBrokerRoutes(server);
    await new Promise<void>((r) => server!.listen(PORT, r));

    const resp = await fetch(`http://localhost:${PORT}/api/agent/desktop-lease-broker/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'wireup-test', priority: 50, ttlMs: 5000 }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(typeof body.granted).toBe('boolean');
  });

  it('POST /ack-yield 只确认当前 lease ID，并由 status 可见', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    registerLeaseBrokerRoutes(server);
    await new Promise<void>((r) => server!.listen(PORT, r));

    const acquire = await fetch(
      `http://localhost:${PORT}/api/agent/desktop-lease-broker/acquire`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 5000,
        }),
      },
    );
    const lease = await acquire.json() as { lease_id: string };
    const ack = await fetch(
      `http://localhost:${PORT}/api/agent/desktop-lease-broker/ack-yield`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaseId: lease.lease_id, clientId: 'line04/listen_chat',
        }),
      },
    );
    const status = await fetch(
      `http://localhost:${PORT}/api/agent/desktop-lease-broker/status`,
    );

    expect(ack.status).toBe(200);
    expect(await ack.json()).toEqual({ ok: true });
    expect(await status.json()).toMatchObject({
      lease_id: lease.lease_id,
      yield_acknowledged: true,
      yield_acknowledged_by: 'line04/listen_chat',
    });
  });

  it('GET /status 响应带 Access-Control-Allow-Origin（apps/agent-panel的useRpaGuard hook从浏览器fetch这个端点，虚拟host与Agent跨源，缺CORS头会被浏览器静默拦截，xian-rog真机验证实测复现）', async () => {
    // 用独立端口（不复用PORT）：紧邻的上一条ack-yield测试内部有真实TTL等待，
    // Node/undici的fetch连接池会在同端口的server重启后复用陈旧keep-alive socket，
    // 触发ECONNRESET("read ECONNRESET"/"other side closed")——本地Node20+CI Node20均实测复现，
    // 与CORS头逻辑本身无关，是端口复用导致的连接池竞态，换独立端口即可规避。
    const isolatedPort = PORT + 1;
    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    registerLeaseBrokerRoutes(server);
    await new Promise<void>((r) => { server!.listen(isolatedPort, r); });

    const status = await fetch(`http://localhost:${isolatedPort}/api/agent/desktop-lease-broker/status`);
    expect(status.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('index.ts 真实启动路径 — 必须调用 registerLeaseBrokerRoutes [ARTIFACT 防回归]', () => {
  it('startLocalDiscoveryServer 函数体内含 registerLeaseBrokerRoutes( 调用', () => {
    const indexPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../index.ts',
    );
    const src = fs.readFileSync(indexPath, 'utf-8');
    const fnStart = src.indexOf('function startLocalDiscoveryServer');
    expect(fnStart).toBeGreaterThan(-1);
    const nextFnStart = src.indexOf('\nfunction ', fnStart + 1);
    const fnBody = src.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);
    expect(fnBody).toContain('registerLeaseBrokerRoutes(');
  });
});
