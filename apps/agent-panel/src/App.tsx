import { AgentPanelApp } from './components/AgentPanelApp';
import { useAgentPanelState } from './hooks/useAgentPanelState';
import { useRpaGuard } from './hooks/useRpaGuard';

export function App() {
  const { lines, connected } = useAgentPanelState();
  const rpaActive = useRpaGuard();
  return <AgentPanelApp lines={lines} rpaActive={rpaActive} connected={connected} />;
}
