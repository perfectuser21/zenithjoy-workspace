import { useEffect, useState } from 'react';
import type { LineState } from '@/shared/types';
import { notifyHostExpandToggle, onHostExpandChanged } from '@/shared/native-bridge';
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
  /** 断线期间产生的done/failed摘要（PrepPRD Golden Path Step10），null=无摘要不显示 */
  reconnectSummary?: { done: number; failed: number } | null;
  onDismissReconnectSummary?: () => void;
}

// 三态编排 + 首次装机仪式（PrepPRD Golden Path Step1）：
// 首次(无本地标记位)自动全屏展开一次亮相，之后收起为常驻灯带；
// RPA 进行中时无论当前处于展开/收起，一律强制渲染贴边只读 mini 视图（抢占式，不等用户手动收起）。
export function AgentPanelApp({
  lines, rpaActive, connected, reconnectSummary = null, onDismissReconnectSummary,
}: AgentPanelAppProps) {
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

  // xian-rog 真机验证实测复现：热键(Ctrl+Alt+Z)/托盘点击只改了原生窗口几何尺寸
  // (MainWindow.xaml.cs ToggleExpanded)，网页内部 expanded 状态从未收到通知——
  // 窗口已经变全屏，内容却仍渲染收起态那个6px小灯。用 setExpandedState（不是
  // setExpanded）直接改内部状态，不再回调 notifyHostExpandToggle，否则跟宿主形成消息乒乓。
  useEffect(() => {
    onHostExpandChanged((next) => setExpandedState(next));
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
      {reconnectSummary && (
        <div data-testid="reconnect-summary-banner">
          离线期间完成
          {' '}
          {reconnectSummary.done}
          {' '}
          个任务，失败
          {' '}
          {reconnectSummary.failed}
          {' '}
          个
          <button
            type="button"
            data-testid="reconnect-summary-dismiss"
            onClick={onDismissReconnectSummary}
          >
            知道了
          </button>
        </div>
      )}
      {body}
    </div>
  );
}
