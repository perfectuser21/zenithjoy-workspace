// apps/dashboard/src/pages/AgentDebugPage.tsx
import { useEffect, useState } from 'react';
import { getAgentStatus, testPublish, AgentStatus } from '../api/agent.api';

export default function AgentDebugPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const data = await getAgentStatus();
      setAgents(data.agents);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const onTest = async () => {
    setBusy(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 触发测试发布...`]);
    try {
      const r = await testPublish();
      setLogs(prev => [...prev, `✅ taskId=${r.taskId}, agentId=${r.agentId}`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `❌ ${e.message}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Agent 调试</h1>

      <section className="mb-6 bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-3">Agent 在线状态</h2>
        {agents.length === 0 ? (
          <div className="text-gray-500">暂无 Agent 在线</div>
        ) : (
          <ul className="space-y-2">
            {agents.map(a => (
              <li key={a.agentId} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${a.online ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="font-mono text-sm">{a.agentId}</span>
                <span className="text-xs text-gray-500">v{a.version} | {a.capabilities.join(',')}</span>
                {a.busy && <span className="text-xs bg-yellow-100 px-2 rounded">忙</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <button
          onClick={onTest}
          disabled={busy || agents.length === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          {busy ? '发布中...' : '测试发布到公众号'}
        </button>
      </section>

      <section className="bg-gray-50 rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto">
        {logs.map((line, i) => <div key={i}>{line}</div>)}
      </section>
    </div>
  );
}
