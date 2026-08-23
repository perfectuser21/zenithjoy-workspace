/**
 * collab-ws 挂载形状 —— attachCollabWS(server) 返回一个 noServer 的 WebSocketServer，
 * 且不占用 http server 的常规路由（只在 upgrade 且路径为 /collab-ws 时接管）。
 * 纯挂载校验，无 DB（真握手鉴权/CV 落库由合同 collab-ws.test.ts 的真 PG + 真 ws 覆盖）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { WebSocketServer } from 'ws';
import { attachCollabWS } from './collab-ws';

let server: http.Server | null = null;

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
});

describe('attachCollabWS', () => {
  it('返回一个 WebSocketServer 实例（noServer 模式）', () => {
    server = http.createServer();
    const wss = attachCollabWS(server);
    expect(wss).toBeInstanceOf(WebSocketServer);
    expect(wss.clients).toBeInstanceOf(Set);
  });

  it('给 http server 注册了 upgrade 监听器（供 /collab-ws 握手接管）', () => {
    server = http.createServer();
    attachCollabWS(server);
    expect(server.listenerCount('upgrade')).toBeGreaterThanOrEqual(1);
  });
});
