import { useEffect, useState } from 'react';
import type { LineState } from '@/shared/types';

// 面板↔Agent 是本地 localhost SSE（判定点：断线重连快照的权威数据源=本地Agent内存，不经中台）。
// Agent 本地发现服务器默认端口 58432（services/agent/src/index.ts）。
const AGENT_LOCAL_BASE = 'http://localhost:58432';

export function useAgentPanelState() {
  const [lines, setLines] = useState<LineState[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`${AGENT_LOCAL_BASE}/api/agent/panel/events/stream`);

    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    es.addEventListener('snapshot', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as LineState[];
        setLines(parsed);
        setConnected(true);
      } catch {
        // 坏帧跳过，不崩面板（面板是旁观者纪律）
      }
    });

    return () => es.close();
  }, []);

  return { lines, connected };
}
