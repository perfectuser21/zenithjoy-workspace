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
