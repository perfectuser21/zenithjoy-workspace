import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startHealthServer, getHealthState, setWsState } from '../health-server';
import http from 'node:http';

describe('health-server', () => {
  let server: http.Server | null = null;
  const PORT = 25201; // test port

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it('GET /healthz 返回 200 + 含 ok/pid/uptime_ms/ws_connected 字段', async () => {
    server = startHealthServer(PORT);
    setWsState('open');

    const resp = await fetch(`http://localhost:${PORT}/healthz`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(typeof body.pid).toBe('number');
    expect(typeof body.uptime_ms).toBe('number');
    expect(body.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(body.ws_connected).toBe(true);
  });

  it('ws 断开后 ws_connected:false', async () => {
    server = startHealthServer(PORT);
    setWsState('closed');

    const resp = await fetch(`http://localhost:${PORT}/healthz`);
    const body = await resp.json();
    expect(body.ws_connected).toBe(false);
  });

  it('非 /healthz 路径返回 404', async () => {
    server = startHealthServer(PORT);

    const resp = await fetch(`http://localhost:${PORT}/foo`);
    expect(resp.status).toBe(404);
  });

  it('getHealthState 返回当前状态对象', () => {
    setWsState('open');
    const s = getHealthState();
    expect(s.ws_connected).toBe(true);
    expect(typeof s.uptime_ms).toBe('number');
  });
});
