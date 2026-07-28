// registerPanelEventRoutes 将 /api/agent/panel/* 路由注入到现有 http.Server
// （仿 registerLeaseBrokerRoutes 同款接线模式：removeAllListeners + 自己接管 + 回退原 listeners）。
//
// GET /api/agent/panel/state          → 一次性快照(供WebView2壳首次加载)
// GET /api/agent/panel/events/stream  → SSE，本地实时推送(壳订阅这个)

import http from 'node:http';
import { PanelEventBus } from '../shared/panel-event-bus';

const KNOWN_LINES = ['line02', 'line04', 'publish'];

function snapshotLines(bus: PanelEventBus) {
  return KNOWN_LINES.map((line) => ({
    line,
    lightState: bus.getLightState(line),
    activeTasks: bus.getActiveTasks(line),
    recentCompleted: bus.getRecentCompleted(line),
  }));
}

export function registerPanelEventRoutes(server: http.Server, bus: PanelEventBus): void {
  const originalListeners = server.listeners('request');
  server.removeAllListeners('request');

  server.on('request', (req, res) => {
    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/api/agent/panel/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, lines: snapshotLines(bus) }));
      return;
    }

    if (req.method === 'GET' && url === '/api/agent/panel/events/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // 首帧：完整快照，壳一连上就有数据可渲染，不用等下一条事件才有内容
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshotLines(bus))}\n\n`);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);
      req.on('close', () => clearInterval(heartbeat));
      return;
    }

    for (const listener of originalListeners) {
      (listener as (req: http.IncomingMessage, res: http.ServerResponse) => void)(req, res);
    }
  });
}
