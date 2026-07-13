// services/agent/src/handlers/health-server.ts
// Sprint 2.1d — HTTP /healthz endpoint 让 supervisor watchdog 检测业务死循环
// 端口 5201（5200 是中台 API，+1 区分）
import http from 'node:http';
import { handleDevVerifyHttp } from './dev-verify-http';

const startTime = Date.now();
let wsState: 'open' | 'closed' | 'connecting' = 'closed';

export function setWsState(state: 'open' | 'closed' | 'connecting'): void {
  wsState = state;
}

export interface HealthState {
  ok: boolean;
  pid: number;
  uptime_ms: number;
  ws_connected: boolean;
}

export function getHealthState(): HealthState {
  return {
    ok: true,
    pid: process.pid,
    uptime_ms: Date.now() - startTime,
    ws_connected: wsState === 'open',
  };
}

export function startHealthServer(port: number = 5201): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getHealthState()));
    } else if (req.method === 'POST' && req.url === '/api/agent-ops/rpa/dev-verify') {
      // T1 快验通道:Brain 代理请求落点。内网闸/白名单/研发机闸/超时全在 handler 内。
      let raw = '';
      req.on('data', (d: Buffer) => { raw += d.toString(); });
      req.on('end', async () => {
        try {
          const body = raw ? JSON.parse(raw) : {};
          const r = await handleDevVerifyHttp(body, req.socket.remoteAddress ?? undefined);
          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r.body));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid_json', message: String(e) }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  server.on('error', (err) => {
    console.warn('[health-server] listen error:', (err as Error).message);
  });
  server.listen(port);
  return server;
}
