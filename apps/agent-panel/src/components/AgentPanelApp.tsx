import { useEffect, useState } from 'react';
import type { LineState } from '@/shared/types';
import { notifyHostExpandToggle } from '@/shared/native-bridge';
import { CollapsedStrip } from './CollapsedStrip';
import { ExpandedPanel } from './ExpandedPanel';
import { RpaMiniView } from './RpaMiniView';

const FIRST_RUN_KEY = 'agent-panel-first-run-shown';

export interface AgentPanelAppProps {
  lines: LineState[];
  /** desktop-lease-broker 判定 RPA 正在进行中（含 fail-closed 兜底结果，由宿主层算好传入） */
  rpaActive: boolean;
  /** 面板↔Agent 本地 SSE 是否连通 */
  connected: boolean;
}

// 三态编排 + 首次装机仪式（PrepPRD Golden Path Step1）：
// 首次(无本地标记位)自动全屏展开一次亮相，之后收起为常驻灯带；
// RPA 进行中时无论当前处于展开/收起，一律强制渲染贴边只读 mini 视图（抢占式，不等用户手动收起）。
export function AgentPanelApp({ lines, rpaActive, connected }: AgentPanelAppProps) {
  const [isFirstRun] = useState(() => {
    const shown = window.localStorage.getItem(FIRST_RUN_KEY) === 'true';
    if (!shown) window.localStorage.setItem(FIRST_RUN_KEY, 'true');
    return !shown;
  });
  const [expanded, setExpandedState] = useState(isFirstRun);
  const setExpanded = (next: boolean) => {
    setExpandedState(next);
    notifyHostExpandToggle(next); // 告诉原生宿主该改窗口尺寸/位置了（宿主只做窗口力学）
  };

  // 挂载时立即告知宿主初始态——宿主默认收起，不该靠猜 React 首次渲染算出的 isFirstRun。
  useEffect(() => {
    notifyHostExpandToggle(isFirstRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body;
  if (rpaActive) {
    body = <RpaMiniView lines={lines} />;
  } else if (expanded) {
    body = (
      <>
        {isFirstRun && (
          <div>作战窗已上线 · 从现在起你能随时看到 AI 在做什么（⌃⌥Z 收起）</div>
        )}
        <ExpandedPanel lines={lines} />
      </>
    );
  } else {
    body = <CollapsedStrip lines={lines} onClick={() => setExpanded(true)} />;
  }

  return (
    <div>
      {!connected && <div>离线/重连中…</div>}
      {body}
    </div>
  );
}
