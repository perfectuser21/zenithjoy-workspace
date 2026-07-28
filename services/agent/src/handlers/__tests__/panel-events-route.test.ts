import {
  describe, it, expect, afterEach,
} from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import { registerPanelEventRoutes } from '../panel-events-route';
import { PanelEventBus } from '../../shared/panel-event-bus';

// registerPanelEventRoutes 挂到真实 http.Server 上——面板(WebView2壳)靠本地 SSE
// 订阅这个端点拿实时事件；GET /state 拿初始快照。
// 仿 desktop-lease-broker-wireup.test.ts 同款"挂到真实 http.Server"验证方式。
describe('registerPanelEventRoutes — 挂到真实 http.Server [BEHAVIOR]', () => {
  let server: http.Server | null = null;
  const PORT = 25311;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => { server!.close(() => r()); });
      server = null;
    }
  });

  it('GET /api/agent/panel/state 返回真实快照(不是404)，含各线灯态', async () => {
    const bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT, r); });

    const resp = await fetch(`http://localhost:${PORT}/api/agent/panel/state`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 'line04', lightState: 'work' })]),
    );
    bus.destroy();
  });

  it('GET /api/agent/panel/events/stream 返回 text/event-stream 且首帧含初始快照', async () => {
    const bus = new PanelEventBus();
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT, r); });

    const resp = await fetch(`http://localhost:${PORT}/api/agent/panel/events/stream`);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');

    const reader = resp.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('event: snapshot');
    await reader.cancel();
    bus.destroy();
  });

  it('不认识的路径交给原有 listeners，不吞掉其它路由', async () => {
    const bus = new PanelEventBus();
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('original-handler');
    });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT, r); });

    const resp = await fetch(`http://localhost:${PORT}/unrelated-path`);
    expect(await resp.text()).toBe('original-handler');
    bus.destroy();
  });
});

describe('index.ts 真实启动路径确实调用了 registerPanelEventRoutes [BEHAVIOR]', () => {
  it('startLocalDiscoveryServer 里必须真调用 registerPanelEventRoutes(server, ...)', () => {
    const srcPath = new URL('../../index.ts', import.meta.url).pathname;
    const src = fs.readFileSync(srcPath, 'utf-8');
    expect(src).toMatch(/registerPanelEventRoutes\(server/);
  });
});
