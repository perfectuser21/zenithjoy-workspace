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
  // 独立端口，避免与相邻测试共用 25311 时偶发 CI 端口复用竞态（"other side closed"，
  // 2026-07-28 CI 两次复现，本机 8/8 稳定通过——怀疑是 undici keep-alive 连接跨测试边界
  // 与 server.close() 时序竞争，用独立端口彻底消除相邻测试间的耦合，不改动其它测试）
  const PORT_LINE02_DYNAMIC = 25312;

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

  it('总线状态变化后 SSE 连接收到新的一帧snapshot（不是只在连接时发一次）——'
    + 'xian-rog真机验证实测发现的真实bug：改之前SSE只在客户端首次连接时写一帧，'
    + '之后事件总线状态怎么变都不会推新帧，网页壳订阅了SSE却实际收不到任何实时更新，'
    + '"实时"看板必须重连/刷新页面才能看到最新数据', async () => {
    const bus = new PanelEventBus();
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT, r); });

    const resp = await fetch(`http://localhost:${PORT}/api/agent/panel/events/stream`);
    const reader = resp.body!.getReader();
    await reader.read(); // 首帧snapshot，跳过

    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: '实时更新测试', ts: Date.now(),
    });

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('event: snapshot');
    expect(chunk).toContain('实时更新测试');
    await reader.cancel();
    bus.destroy();
  });

  it('快照每条line带connected字段，只有line04是真实接入(PRD原话"只有真实接入的line04会上灯")——'
    + '壳侧CollapsedStrip.tsx用lines.filter(l=>l.connected)决定上不上灯带，connected缺失时'
    + '恒为undefined/falsy，灯带永远空白（xian-rog真机验证实测复现：有真实业务数据+CORS都修好后'
    + '收起态灯带仍然是空白8px无内容）', async () => {
    const bus = new PanelEventBus();
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT, r); });

    const resp = await fetch(`http://localhost:${PORT}/api/agent/panel/state`);
    const body = await resp.json();
    const byLine = Object.fromEntries(body.lines.map((l: { line: string; connected: boolean }) => [l.line, l.connected]));
    expect(byLine).toEqual({ line02: false, line04: true, publish: false });

    bus.destroy();
  });

  it('Sprint 07282119-agent-panel-knife2-android：line02 的 connected 是动态判定，不是硬编码——'
    + 'PanelLine02Bridge 真实调用 bus.ingest() 拿到过 line02 数据（哪怕一次）后才反转为 true'
    + '（"有灯没线"假绿的反面：桥接失败时客户端不能仍显示"已接入"掩盖真实故障）', async () => {
    const bus = new PanelEventBus();
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT_LINE02_DYNAMIC, r); });

    const respBefore = await fetch(`http://localhost:${PORT_LINE02_DYNAMIC}/api/agent/panel/state`);
    const bodyBefore = await respBefore.json();
    const byLineBefore = Object.fromEntries(
      bodyBefore.lines.map((l: { line: string; connected: boolean }) => [l.line, l.connected]),
    );
    expect(byLineBefore).toEqual({ line02: false, line04: true, publish: false });

    bus.ingest({
      event: 'task_started', task_id: 't-line02-bridge', line: 'line02', device: 'RMX3478-b6ee', title: 'x', ts: Date.now(),
    });

    const respAfter = await fetch(`http://localhost:${PORT_LINE02_DYNAMIC}/api/agent/panel/state`);
    const bodyAfter = await respAfter.json();
    const byLineAfter = Object.fromEntries(
      bodyAfter.lines.map((l: { line: string; connected: boolean }) => [l.line, l.connected]),
    );
    expect(byLineAfter).toEqual({ line02: true, line04: true, publish: false });

    bus.destroy();
  });

  it('响应带 Access-Control-Allow-Origin，壳走虚拟host(http://agent-panel.local)与Agent(http://localhost:port)跨源，浏览器fetch/EventSource无CORS头会被浏览器静默拦截(xian-rog真机验证实测复现：直接导航能连通，fetch却"Failed to fetch")', async () => {
    const bus = new PanelEventBus();
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    registerPanelEventRoutes(server, bus);
    await new Promise<void>((r) => { server!.listen(PORT, r); });

    const stateResp = await fetch(`http://localhost:${PORT}/api/agent/panel/state`);
    expect(stateResp.headers.get('access-control-allow-origin')).toBe('*');

    const streamResp = await fetch(`http://localhost:${PORT}/api/agent/panel/events/stream`);
    expect(streamResp.headers.get('access-control-allow-origin')).toBe('*');
    await streamResp.body!.cancel();

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
