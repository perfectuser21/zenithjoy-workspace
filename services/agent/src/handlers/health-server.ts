// services/agent/src/handlers/health-server.ts
// Sprint 2.1d — HTTP /healthz endpoint 让 supervisor watchdog 检测业务死循环
// 端口 5201（5200 是中台 API，+1 区分）
import http from 'node:http';

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
