// registerPanelEventRoutes 将 /api/agent/panel/* 路由注入到现有 http.Server
// （仿 registerLeaseBrokerRoutes 同款接线模式：removeAllListeners + 自己接管 + 回退原 listeners）。
//
// GET /api/agent/panel/state          → 一次性快照(供WebView2壳首次加载)
// GET /api/agent/panel/events/stream  → SSE，本地实时推送(壳订阅这个)

import http from 'node:http';
import { PanelEventBus } from '../shared/panel-event-bus';

const KNOWN_LINES = ['line02', 'line04', 'publish'];

// PrepPRD 原话"只有真实接入的line04会上灯"——line02/publish 目前是占位线，尚未真实接入
// 事件总线。壳侧 CollapsedStrip.tsx 用 lines.filter(l=>l.connected) 决定上不上灯带，
// 缺这个字段时恒为 undefined/falsy，灯带永远空白（xian-rog真机验证实测复现）。
const CONNECTED_LINES = new Set(['line04']);

function snapshotLines(bus: PanelEventBus) {
  return KNOWN_LINES.map((line) => ({
    line,
    connected: CONNECTED_LINES.has(line),
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
      // xian-rog 真机验证实测：壳网页经 SetVirtualHostNameToFolderMapping 跑在
      // http://agent-panel.local，与 Agent 本地服务器(http://localhost:port)是不同源，
      // 浏览器 fetch 缺 CORS 头会被浏览器静默拦截("Failed to fetch"，不报HTTP错误码，
      // 直接导航能连通但subresource fetch/EventSource连不通)。
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, lines: snapshotLines(bus) }));
      return;
    }

    if (req.method === 'GET' && url === '/api/agent/panel/events/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      // 首帧：完整快照，壳一连上就有数据可渲染，不用等下一条事件才有内容
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshotLines(bus))}\n\n`);

      // xian-rog 真机验证实测发现：这里原来只发首帧，之后总线状态怎么变都不会推新帧——
      // 网页壳订阅了SSE但实际收不到任何实时更新，"实时"看板必须重连/刷新页面才看得到最新数据。
      // bus.onChange 在每次事件(task_started/step/waiting/stuck/done/failed)真正改变状态后
      // 触发，这里订阅它，每次变化都重新推一帧完整快照给这个客户端。
      const unsubscribe = bus.onChange(() => {
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshotLines(bus))}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    for (const listener of originalListeners) {
      (listener as (req: http.IncomingMessage, res: http.ServerResponse) => void)(req, res);
    }
  });
}
