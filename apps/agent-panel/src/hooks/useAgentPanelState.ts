import { useEffect, useRef, useState } from 'react';
import type { LineState } from '@/shared/types';

// 面板↔Agent 是本地 localhost SSE（判定点：断线重连快照的权威数据源=本地Agent内存，不经中台）。
// Agent 本地发现服务器默认端口 58432（services/agent/src/index.ts）。
const AGENT_LOCAL_BASE = 'http://localhost:58432';

export interface ReconnectSummary {
  done: number;
  failed: number;
}

function recentCompletedIds(lines: LineState[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    for (const task of line.recentCompleted) ids.add(task.task_id);
  }
  return ids;
}

export function useAgentPanelState() {
  const [lines, setLines] = useState<LineState[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnectSummary, setReconnectSummary] = useState<ReconnectSummary | null>(null);

  // PrepPRD Golden Path Step10："重连后从Agent本地内存拉取当前活跃task最新快照直接覆盖UI
  // (不经中台，不重放历史事件流)；重连成功后对期间产生的done/failed事件一次性弹出摘要"——
  // 不重放事件流意味着算不出"发生过什么"，只能靠对比断线前后 recentCompleted 快照的差集。
  const wasDisconnected = useRef(false);
  const knownCompletedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource(`${AGENT_LOCAL_BASE}/api/agent/panel/events/stream`);

    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => {
      setConnected(false);
      wasDisconnected.current = true;
    });
    es.addEventListener('snapshot', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as LineState[];

        if (wasDisconnected.current) {
          let done = 0;
          let failed = 0;
          for (const line of parsed) {
            for (const task of line.recentCompleted) {
              if (knownCompletedIds.current.has(task.task_id)) continue;
              if (task.state === 'done') done += 1;
              else if (task.state === 'failed') failed += 1;
            }
          }
          if (done > 0 || failed > 0) setReconnectSummary({ done, failed });
          wasDisconnected.current = false;
        }

        knownCompletedIds.current = recentCompletedIds(parsed);
        setLines(parsed);
        setConnected(true);
      } catch {
        // 坏帧跳过，不崩面板（面板是旁观者纪律）
      }
    });

    return () => es.close();
  }, []);

  const dismissReconnectSummary = () => setReconnectSummary(null);

  return {
    lines, connected, reconnectSummary, dismissReconnectSummary,
  };
}
