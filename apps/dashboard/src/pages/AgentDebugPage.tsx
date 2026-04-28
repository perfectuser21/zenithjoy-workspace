// apps/dashboard/src/pages/AgentDebugPage.tsx
import { useEffect, useState } from 'react';
import {
  getAgentStatus,
  testPublish,
  testPublishDouyin,
  testPublishKuaishou,
  testPublishXiaohongshu,
  testPublishToutiao,
  testPublishWeibo,
  testPublishShipinhao,
  testPublishZhihu,
  AgentStatus,
} from '../api/agent.api';

// v0.3：6 个新平台按钮配置（capability slug + 中文名 + Tailwind 颜色 class）
interface PlatformButton {
  slug: string;
  label: string;
  bgClass: string;
}

const EXTRA_PLATFORMS: PlatformButton[] = [
  { slug: 'kuaishou', label: '快手', bgClass: 'bg-orange-500' },
  { slug: 'xiaohongshu', label: '小红书', bgClass: 'bg-red-500' },
  { slug: 'toutiao', label: '头条', bgClass: 'bg-blue-500' },
  { slug: 'weibo', label: '微博', bgClass: 'bg-yellow-500' },
  { slug: 'shipinhao', label: '视频号', bgClass: 'bg-green-500' },
  { slug: 'zhihu', label: '知乎', bgClass: 'bg-gray-500' },
];

const PLATFORM_API: Record<string, () => Promise<{ ok: boolean; taskId: string; agentId: string }>> = {
  kuaishou: testPublishKuaishou,
  xiaohongshu: testPublishXiaohongshu,
  toutiao: testPublishToutiao,
  weibo: testPublishWeibo,
  shipinhao: testPublishShipinhao,
  zhihu: testPublishZhihu,
};

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
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 触发公众号测试发布...`]);
    try {
      const r = await testPublish();
      setLogs(prev => [...prev, `[OK] wechat taskId=${r.taskId}, agentId=${r.agentId}`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `[FAIL] ${e.message}`]);
    } finally {
      setBusy(false);
    }
  };

  const onTestDouyin = async () => {
    setBusy(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 触发抖音 dry-run（不真发）...`]);
    try {
      const r = await testPublishDouyin();
      setLogs(prev => [...prev, `[OK] douyin taskId=${r.taskId}, agentId=${r.agentId}`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `[FAIL] ${e.message}`]);
    } finally {
      setBusy(false);
    }
  };

  const onTestPlatform = async (slug: string, label: string) => {
    const apiFn = PLATFORM_API[slug];
    if (!apiFn) return;
    setBusy(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 触发${label} dry-run（不真发）...`]);
    try {
      const r = await apiFn();
      setLogs(prev => [...prev, `[OK] ${slug} taskId=${r.taskId}, agentId=${r.agentId}`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `[FAIL] ${e.message}`]);
    } finally {
      setBusy(false);
    }
  };

  const hasCapability = (slug: string) =>
    agents.some(a => a.online && a.capabilities.includes(slug));

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

      <section className="mb-6 flex gap-3 flex-wrap">
        <button
          onClick={onTest}
          disabled={busy || agents.length === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          {busy ? '发布中...' : '测试发布到公众号'}
        </button>
        <button
          onClick={onTestDouyin}
          disabled={busy || !hasCapability('douyin')}
          className="px-4 py-2 bg-pink-500 text-white rounded disabled:bg-gray-300"
          title="走完上传/标题/文案，但不点击发布按钮，不污染抖音公域"
        >
          {busy ? '发送中...' : '测试发抖音 (dry-run) → Windows Agent'}
        </button>
        {EXTRA_PLATFORMS.map(p => (
          <button
            key={p.slug}
            onClick={() => onTestPlatform(p.slug, p.label)}
            disabled={busy || !hasCapability(p.slug)}
            className={`px-4 py-2 ${p.bgClass} text-white rounded disabled:bg-gray-300`}
            title={`走完上传/标题/文案，但不点击发布按钮，不污染${p.label}公域`}
          >
            {busy ? '发送中...' : `测试发${p.label} (dry-run)`}
          </button>
        ))}
      </section>

      <section className="bg-gray-50 rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto">
        {logs.map((line, i) => <div key={i}>{line}</div>)}
      </section>
    </div>
  );
}
