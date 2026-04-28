import { useEffect, useState, useCallback } from 'react';
import {
  getAgentStatus,
  listTasks,
  listSkills,
  createTask,
  AgentStatus,
  AgentTask,
  Skill,
} from '../api/agent.api';

// ── 平台元数据 ─────────────────────────────────────────────
const PLATFORM_META: Record<string, { label: string; bg: string; text: string }> = {
  wechat:      { label: '公众号', bg: 'bg-green-500',  text: 'text-white' },
  douyin:      { label: '抖音',   bg: 'bg-gray-900',   text: 'text-white' },
  kuaishou:    { label: '快手',   bg: 'bg-orange-500', text: 'text-white' },
  xiaohongshu: { label: '小红书', bg: 'bg-red-500',    text: 'text-white' },
  toutiao:     { label: '头条',   bg: 'bg-blue-500',   text: 'text-white' },
  weibo:       { label: '微博',   bg: 'bg-red-600',    text: 'text-white' },
  shipinhao:   { label: '视频号', bg: 'bg-green-600',  text: 'text-white' },
  zhihu:       { label: '知乎',   bg: 'bg-blue-700',   text: 'text-white' },
};

const CATEGORY_LABEL: Record<string, string> = {
  publish:        '发布',
  data_collection:'数据采集',
  account_mgmt:   '账号管理',
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  image:   '图文',
  video:   '视频',
  article: '文章',
  idea:    '想法',
};

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
function TaskStatusBadge({ status }: { status: AgentTask['status'] }) {
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

function SkillStatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready:         'bg-green-500',
    login_expired: 'bg-yellow-500',
    unavailable:   'bg-red-400',
    unknown:       'bg-gray-300',
  };
  const label: Record<string, string> = {
    ready:         '就绪',
    login_expired: '登录过期',
    unavailable:   '不可用',
    unknown:       '未知',
  };
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      <span className={`w-2 h-2 rounded-full ${map[status] ?? 'bg-gray-300'}`} />
      {label[status] ?? status}
    </span>
  );
}

// ── Agent 卡片 ─────────────────────────────────────────────
function AgentCard({ agent }: { agent: AgentStatus }) {
  const heartbeatAge = Math.floor((Date.now() - agent.lastHeartbeat) / 1000);
  const isStale = heartbeatAge > 45;

  return (
    <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
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
      <div className="flex flex-wrap gap-1.5 mt-2">
        {agent.capabilities.map(cap => {
          const meta = PLATFORM_META[cap];
          return (
            <span key={cap} className={`px-2 py-0.5 rounded text-xs font-medium ${meta ? `${meta.bg} ${meta.text}` : 'bg-gray-100 text-gray-600'}`}>
              {meta?.label ?? cap}
            </span>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-gray-400">接入 {relativeTime(agent.connectedAt)}</div>
    </div>
  );
}

// ── Skill 目录 ─────────────────────────────────────────────
function SkillCatalog({ skills, agents }: { skills: Skill[]; agents: AgentStatus[] }) {
  const [filterPlatform, setFilterPlatform] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');

  const platforms = [...new Set(skills.map(s => s.platform))].sort();
  const categories = [...new Set(skills.map(s => s.category))].sort();

  const filtered = skills.filter(s =>
    (!filterPlatform || s.platform === filterPlatform) &&
    (!filterCategory || s.category === filterCategory)
  );

  // 按平台分组
  const byPlatform: Record<string, Skill[]> = {};
  for (const s of filtered) {
    if (!byPlatform[s.platform]) byPlatform[s.platform] = [];
    byPlatform[s.platform].push(s);
  }

  const onlineAgentIds = agents.filter(a => a.online).map(a => a.agentId);

  return (
    <div className="bg-white rounded-xl shadow border border-gray-100">
      {/* 过滤栏 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700">技能目录</span>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} 个技能</span>
        <select
          value={filterPlatform}
          onChange={e => setFilterPlatform(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600"
        >
          <option value="">全部平台</option>
          {platforms.map(p => (
            <option key={p} value={p}>{PLATFORM_META[p]?.label ?? p}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600"
        >
          <option value="">全部类别</option>
          {categories.map(c => (
            <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>
          ))}
        </select>
      </div>

      {Object.keys(byPlatform).length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">暂无技能数据（等待 DB 迁移或 Agent 上报）</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {Object.entries(byPlatform).map(([platform, platformSkills]) => {
            const meta = PLATFORM_META[platform];
            return (
              <div key={platform} className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold text-white ${meta?.bg ?? 'bg-gray-500'}`}>
                    {meta?.label ?? platform}
                  </span>
                  <span className="text-xs text-gray-400">{platformSkills.length} 个技能</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {platformSkills.map(skill => {
                    const agentStatuses = Object.entries(skill.agent_statuses).filter(([aid]) =>
                      onlineAgentIds.includes(aid)
                    );
                    const bestStatus = agentStatuses.find(([, s]) => s.status === 'ready')
                      ? 'ready'
                      : agentStatuses.find(([, s]) => s.status === 'login_expired')
                        ? 'login_expired'
                        : agentStatuses.length > 0
                          ? agentStatuses[0][1].status
                          : 'unknown';

                    return (
                      <div key={skill.slug} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-sm text-gray-800 leading-tight">{skill.name}</div>
                          <SkillStatusDot status={bestStatus} />
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {skill.category !== 'publish' && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                              {CATEGORY_LABEL[skill.category] ?? skill.category}
                            </span>
                          )}
                          {skill.content_type && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                              {CONTENT_TYPE_LABEL[skill.content_type] ?? skill.content_type}
                            </span>
                          )}
                          {skill.is_dryrun && (
                            <span className="text-xs bg-yellow-50 text-yellow-600 px-1.5 py-0.5 rounded">演练</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-1.5 font-mono truncate" title={skill.script_path}>
                          {skill.script_path.split('/').pop()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 任务行 ─────────────────────────────────────────────────
function TaskRow({ task }: { task: AgentTask }) {
  const platform = Object.entries(PLATFORM_META).find(([slug]) => task.skill.startsWith(slug));
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
        <td className="px-4 py-3 text-xs font-mono text-gray-600 max-w-[200px] truncate" title={task.skill}>
          {platform ? (
            <span className={`inline-block mr-1.5 px-2 py-0.5 rounded text-xs font-medium text-white ${platform[1].bg}`}>
              {platform[1].label}
            </span>
          ) : null}
          {task.skill}
        </td>
        <td className="px-4 py-3">
          <TaskStatusBadge status={task.status} />
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
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tab, setTab] = useState<'agents' | 'skills' | 'tasks'>('agents');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const [agentData, taskData, skillData] = await Promise.all([
        getAgentStatus(),
        listTasks(),
        listSkills(),
      ]);
      setAgents(agentData.agents);
      setTasks(taskData.tasks.slice(0, 30));
      setSkills(skillData.skills);
      setLastRefresh(Date.now());
    } catch (e) {
      console.error('[agent-debug] refresh error:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const trigger = async (slug: string) => {
    if (triggering) return;
    setTriggering(slug);
    try {
      await createTask(slug, { _trigger: 'dashboard', ts: Date.now() });
      setTab('tasks');
      await refresh();
    } catch (e: any) {
      console.error('[trigger]', e.message);
    } finally {
      setTriggering(null);
    }
  };

  const onlineAgents = agents.filter(a => a.online);
  const runningCount = tasks.filter(t => t.status === 'running').length;
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;

  const dryrunSkills = skills.filter(s => s.is_dryrun);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* ── 顶部状态栏 ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Agent 控制台</h1>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="text-xs">刷新于 {new Date(lastRefresh).toLocaleTimeString('zh-CN')}</span>
          <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">
            {onlineAgents.length} 台在线
          </span>
          {runningCount > 0 && (
            <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium animate-pulse">
              {runningCount} 个任务运行中
            </span>
          )}
          <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
            {skills.length} 个技能
          </span>
        </div>
      </div>

      {/* ── Tab 导航 ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(['agents', 'skills', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'agents' ? `Agent 状态 (${onlineAgents.length})` : t === 'skills' ? `技能目录 (${skills.length})` : `任务流水 (${tasks.length})`}
          </button>
        ))}
      </div>

      {/* ── Tab: Agent 状态 ── */}
      {tab === 'agents' && (
        <>
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

          {/* 快速触发演练 */}
          {dryrunSkills.length > 0 && (
            <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800 text-sm">演练触发</h2>
                <span className="text-xs text-gray-400">dry-run — 走完全流程但不真实发布</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {dryrunSkills.map(skill => {
                  const meta = PLATFORM_META[skill.platform];
                  const busy = triggering === skill.slug;
                  const hasAgent = onlineAgents.length > 0;
                  return (
                    <button
                      key={skill.slug}
                      onClick={() => trigger(skill.slug)}
                      disabled={!hasAgent || !!triggering}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${hasAgent && !triggering
                          ? `${meta?.bg ?? 'bg-gray-500'} text-white hover:opacity-90 active:scale-95`
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                      {busy
                        ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <span>▶</span>
                      }
                      {meta?.label ?? skill.platform}・{skill.name.replace('（演练）', '')}
                    </button>
                  );
                })}
              </div>
              {onlineAgents.length === 0 && (
                <div className="mt-2 text-xs text-red-500">⚠ 无 Agent 在线，无法触发任务</div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Tab: 技能目录 ── */}
      {tab === 'skills' && (
        <SkillCatalog skills={skills} agents={agents} />
      )}

      {/* ── Tab: 任务流水 ── */}
      {tab === 'tasks' && (
        <div className="bg-white rounded-xl shadow border border-gray-100">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">任务流水（最近 30 条）</h2>
            <div className="flex gap-3 text-xs text-gray-500">
              <span className="text-green-600 font-medium">✓ {doneCount} 完成</span>
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
                    <th className="px-4 py-2 text-left font-medium">技能</th>
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
      )}

    </div>
  );
}
