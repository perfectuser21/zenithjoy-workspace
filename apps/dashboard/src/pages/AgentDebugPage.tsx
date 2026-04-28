import { useEffect, useState, useCallback } from 'react';
import {
  getAgentStatus,
  listTasks,
  createTask,
  AgentStatus,
  AgentTask,
} from '../api/agent.api';

// ── 平台元数据 ─────────────────────────────────────────────
const PLATFORMS = [
  { slug: 'wechat',      label: '公众号', bg: 'bg-green-500',   text: 'text-white' },
  { slug: 'douyin',      label: '抖音',   bg: 'bg-gray-900',    text: 'text-white' },
  { slug: 'kuaishou',    label: '快手',   bg: 'bg-orange-500',  text: 'text-white' },
  { slug: 'xiaohongshu', label: '小红书', bg: 'bg-red-500',     text: 'text-white' },
  { slug: 'toutiao',     label: '头条',   bg: 'bg-blue-500',    text: 'text-white' },
  { slug: 'weibo',       label: '微博',   bg: 'bg-red-600',     text: 'text-white' },
  { slug: 'shipinhao',   label: '视频号', bg: 'bg-green-600',   text: 'text-white' },
  { slug: 'zhihu',       label: '知乎',   bg: 'bg-blue-700',    text: 'text-white' },
];

// ── 工具函数 ───────────────────────────────────────────────
function relativeTime(ts: number | string) {
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  return `${Math.floor(sec / 3600)}小时前`;
}

function duration(start: string | null, end: string | null) {
  if (!start) return '—';
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── 状态 Badge ─────────────────────────────────────────────
function StatusBadge({ status }: { status: AgentTask['status'] }) {
  const map = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-100 text-blue-700',
    done:    'bg-green-100 text-green-700',
    failed:  'bg-red-100 text-red-700',
  };
  const label = { pending: '等待', running: '运行中', done: '完成', failed: '失败' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${map[status]}`}>
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {label[status]}
    </span>
  );
}

// ── Agent 卡片 ─────────────────────────────────────────────
function AgentCard({ agent }: { agent: AgentStatus }) {
  const heartbeatAge = Math.floor((Date.now() - agent.lastHeartbeat) / 1000);
  const isStale = heartbeatAge > 45;

  return (
    <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
      {/* 头部：在线状态 + ID */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${agent.online && !isStale ? 'bg-green-500 shadow-green-300 shadow-md' : 'bg-gray-400'}`} />
          <div>
            <div className="font-semibold text-gray-800 font-mono text-sm">{agent.agentId}</div>
            <div className="text-xs text-gray-400">v{agent.version}</div>
          </div>
        </div>
        <div className="text-right">
          {agent.busy ? (
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">执行任务中</span>
          ) : (
            <span className="px-2 py-1 bg-green-50 text-green-600 text-xs rounded-full font-medium">空闲</span>
          )}
          <div className="text-xs text-gray-400 mt-1">心跳 {relativeTime(agent.lastHeartbeat)}</div>
        </div>
      </div>

      {/* 平台能力表格 */}
      <div className="mb-1 text-xs text-gray-500 font-medium uppercase tracking-wide">平台能力 &amp; 登录状态</div>
      <div className="grid grid-cols-4 gap-2 mt-2">
        {PLATFORMS.map(p => {
          const hasCap = agent.capabilities.includes(p.slug);
          return (
            <div
              key={p.slug}
              className={`rounded-lg p-2 text-center ${hasCap ? p.bg : 'bg-gray-100'}`}
            >
              <div className={`text-xs font-medium ${hasCap ? p.text : 'text-gray-400'}`}>{p.label}</div>
              <div className={`text-xs mt-0.5 ${hasCap ? 'text-white/80' : 'text-gray-300'}`}>
                {hasCap ? '已加载' : '不支持'}
              </div>
              <div className={`text-xs mt-0.5 ${hasCap ? 'text-white/70' : 'text-gray-300'}`}>
                {hasCap ? '登录状态待查' : '—'}
              </div>
            </div>
          );
        })}
      </div>

      {/* 连接时长 */}
      <div className="mt-3 text-xs text-gray-400">
        连入时间：{relativeTime(agent.connectedAt)}
      </div>
    </div>
  );
}

// ── 任务行 ─────────────────────────────────────────────────
function TaskRow({ task }: { task: AgentTask }) {
  const platform = PLATFORMS.find(p => task.skill.startsWith(p.slug));
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          {new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </td>
        <td className="px-4 py-3">
          {platform ? (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium text-white ${platform.bg}`}>
              {platform.label}
            </span>
          ) : (
            <span className="text-xs text-gray-500 font-mono">{task.skill}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={task.status} />
        </td>
        <td className="px-4 py-3 text-xs text-gray-500 font-mono">
          {task.agentText || task.agentId || '—'}
        </td>
        <td className="px-4 py-3 text-xs text-gray-400 text-right">
          {duration(task.startedAt, task.finishedAt)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-4 py-3">
            {task.status === 'failed' && task.error && (
              <div className="mb-2 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700 font-mono">
                ✗ {task.error}
              </div>
            )}
            {task.status === 'done' && task.result && (
              <div className="mb-2 p-2 bg-green-50 border border-green-100 rounded text-xs text-green-700 font-mono">
                ✓ {JSON.stringify(task.result, null, 2)}
              </div>
            )}
            <div className="text-xs text-gray-400 font-mono space-y-1">
              <div>task_id: {task.id}</div>
              {task.startedAt && <div>started: {new Date(task.startedAt).toLocaleTimeString('zh-CN')}</div>}
              {task.finishedAt && <div>finished: {new Date(task.finishedAt).toLocaleTimeString('zh-CN')}</div>}
              <div>params: {JSON.stringify(task.params)}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── 主页面 ─────────────────────────────────────────────────
export default function AgentDebugPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const [agentData, taskData] = await Promise.all([
        getAgentStatus(),
        listTasks(),
      ]);
      setAgents(agentData.agents);
      setTasks(taskData.tasks.slice(0, 30));
      setLastRefresh(Date.now());
    } catch (e) {
      console.error('[agent-debug] refresh error:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const trigger = async (platform: typeof PLATFORMS[number]) => {
    if (triggering) return;
    setTriggering(platform.slug);
    try {
      await createTask(`${platform.slug}_dryrun`, { _trigger: 'dashboard', ts: Date.now() });
      await refresh();
    } catch (e: any) {
      console.error('[trigger]', e.message);
    } finally {
      setTriggering(null);
    }
  };

  const onlineAgents = agents.filter(a => a.online);
  const hasCapability = (slug: string) => onlineAgents.some(a => a.capabilities.includes(slug));

  const runningCount = tasks.filter(t => t.status === 'running').length;
  const doneToday = tasks.filter(t => t.status === 'done').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── 顶部状态栏 ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Agent 控制台</h1>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>刷新于 {new Date(lastRefresh).toLocaleTimeString('zh-CN')}</span>
          <div className="flex gap-3">
            <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">
              {onlineAgents.length} 台在线
            </span>
            {runningCount > 0 && (
              <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium animate-pulse">
                {runningCount} 个任务运行中
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Agent 卡片区 ── */}
      {agents.length === 0 ? (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-10 text-center text-gray-400">
          <div className="text-4xl mb-3">📡</div>
          <div className="text-lg font-medium">暂无 Agent 在线</div>
          <div className="text-sm mt-1">西安 PC 需要运行 zenithjoy-agent.exe 并连接到云端</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {agents.map(a => <AgentCard key={a.agentId} agent={a} />)}
        </div>
      )}

      {/* ── 触发区 ── */}
      <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">触发测试任务</h2>
          <span className="text-xs text-gray-400">dry-run — 走完全流程但不真实发布</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {PLATFORMS.map(p => {
            const capable = hasCapability(p.slug);
            const busy = triggering === p.slug;
            return (
              <button
                key={p.slug}
                onClick={() => trigger(p)}
                disabled={!capable || !!triggering}
                className={`flex flex-col items-center p-3 rounded-lg transition-all text-xs font-medium
                  ${capable && !triggering
                    ? `${p.bg} ${p.text} hover:opacity-90 active:scale-95`
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
              >
                {busy ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mb-1" />
                ) : (
                  <span className="text-lg mb-1">
                    {!capable ? '⊘' : '▶'}
                  </span>
                )}
                {p.label}
              </button>
            );
          })}
        </div>
        {onlineAgents.length === 0 && (
          <div className="mt-3 text-xs text-red-500">⚠ 无 Agent 在线，无法触发任务</div>
        )}
      </div>

      {/* ── 任务流水 ── */}
      <div className="bg-white rounded-xl shadow border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">任务流水（最近 30 条）</h2>
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="text-green-600 font-medium">✓ {doneToday} 完成</span>
            {runningCount > 0 && <span className="text-blue-600 font-medium">⟳ {runningCount} 运行中</span>}
            {failedCount > 0 && <span className="text-red-600 font-medium">✗ {failedCount} 失败</span>}
          </div>
        </div>
        {tasks.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">暂无任务记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 text-left font-medium">时间</th>
                  <th className="px-4 py-2 text-left font-medium">平台</th>
                  <th className="px-4 py-2 text-left font-medium">状态</th>
                  <th className="px-4 py-2 text-left font-medium">Agent</th>
                  <th className="px-4 py-2 text-right font-medium">耗时</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => <TaskRow key={t.id} task={t} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
