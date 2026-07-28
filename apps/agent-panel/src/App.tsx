import { useEffect } from 'react';
import { AgentPanelApp } from './components/AgentPanelApp';
import { useAgentPanelState } from './hooks/useAgentPanelState';
import { useRpaGuard } from './hooks/useRpaGuard';
import { notifyHostLightState } from './shared/native-bridge';

export function App() {
  const {
    lines, connected, reconnectSummary, dismissReconnectSummary,
  } = useAgentPanelState();
  const rpaActive = useRpaGuard();

  // PrepPRD Golden Path Step9：宿主(C#侧)全屏隐藏浮条时仍要能让托盘图标变红提示stuck，
  // 灯态聚合网页侧已经在算(渲染灯带颜色的同一份数据)，这里顺带告诉宿主，不在C#重复实现。
  useEffect(() => {
    const hasStuck = lines.some((l) => l.connected && l.lightState === 'stuck');
    notifyHostLightState(hasStuck);
  }, [lines]);

  return (
    <AgentPanelApp
      lines={lines}
      rpaActive={rpaActive}
      connected={connected}
      reconnectSummary={reconnectSummary}
      onDismissReconnectSummary={dismissReconnectSummary}
    />
  );
}
