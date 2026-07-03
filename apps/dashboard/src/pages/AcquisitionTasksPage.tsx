/**
 * AcquisitionTasksPage — 智能获客 · 采集任务（两级视图）
 *
 * Line02 获客工作台 IA 重设计 Track A：
 *   一级（/area/acquisition/tasks）        — 关键词输入 + 历史任务列表
 *   二级（/area/acquisition/tasks/:taskId）— 该任务下的视频卡片列表 + 展开评论
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronRight, Search, AlertTriangle } from 'lucide-react';
import { fetchMachines, fetchBurnerSessions, type Machine, type BurnerSession } from '../api/machines.api';

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '采集中',
  cancelling: '取消中',
  cancelled: '已取消',
  done: '已完成',
  stage_1_done: '进行中',
  partial: '部分完成',
  failed: '失败',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-700 text-gray-300',
  running: 'bg-blue-900/40 text-blue-300',
  done: 'bg-green-900/40 text-green-300',
  partial: 'bg-amber-900/40 text-amber-300',
  failed: 'bg-red-900/40 text-red-300',
  cancelled: 'bg-gray-700 text-gray-400',
  cancelling: 'bg-gray-700 text-gray-400',
  stage_1_done: 'bg-blue-900/40 text-blue-300',
};

interface Task {
  id: string;
  keywords: string[];
  status: string;
  created_at: string | null;
  video_count: number;
  lead_count_raw: number;
}

interface Video {
  video_id: string;
  title: string | null;
  thumbnail_url: string | null;
  publish_date: string | null;
  comment_count: number;
}

interface Lead {
  commenter_id: string;
  comment_text: string;
  source_video_url: string;
  grade: string;
  profile_url: string | null;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-gray-700 text-gray-300'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TaskListView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [starting, setStarting] = useState(false);
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [burnerSessions, setBurnerSessions] = useState<BurnerSession[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/acquisition/collect-tasks');
      const j = await r.json();
      if (!j?.success) {
        setError(j?.error?.message || '加载任务列表失败');
        return;
      }
      setTasks(j.data.tasks ?? []);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    fetchMachines().then(setMachines).catch(() => setMachines([]));
    fetchBurnerSessions().then(setBurnerSessions).catch(() => setBurnerSessions([]));
  }, []);

  const onlineMachines = (machines ?? []).filter((m) => m.status === 'online');
  const activeBurnerSessions = burnerSessions.filter((s) => s.status === 'active');
  const selectedSession = activeBurnerSessions.find((s) => s.account_label === selectedAccount);
  const noOnlineMachine = machines !== null && onlineMachines.length === 0;

  async function handleStart() {
    const words = keyword.split(/[,，\s]+/).map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) return;
    setStarting(true);
    setError('');
    try {
      const preferredAgentId = localStorage.getItem('preferred_agent_id') || undefined;
      const r = await fetch('/api/acquisition/collect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: words,
          ...(selectedAccount ? { account_label: selectedAccount } : {}),
          ...(preferredAgentId ? { agent_id: preferredAgentId } : {}),
        }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.error?.message || '发起采集失败');
        return;
      }
      setKeyword('');
      await load();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-2 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">采集任务</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">输入关键词发起采集，或查看历史任务的视频+评论明细。</p>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300 text-sm">{error}</div>
      ) : null}

      {noOnlineMachine ? (
        <div className="flex items-center gap-1.5 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4" />
          无在线机器，无法创建采集任务 — 请先确认客户端在线
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="关键词（逗号或空格分隔多个），例：美甲"
            className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
          />
          <select
            aria-label="使用账号"
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
          >
            <option value="">不指定账号</option>
            {activeBurnerSessions.map((s) => (
              <option key={s.account_label} value={s.account_label}>
                {s.account_nickname || s.account_label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!keyword.trim() || starting || noOnlineMachine}
            onClick={handleStart}
            className="flex items-center gap-1 rounded bg-emerald-600 px-4 py-2 text-white text-sm disabled:bg-gray-300 dark:disabled:bg-slate-700"
          >
            <Search className="w-4 h-4" />
            开始采集
          </button>
        </div>
        {selectedSession ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            将在 {selectedSession.nickname || selectedSession.hostname} 上运行
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">历史任务</h3>
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">载入中…</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
            暂无任务 — 在上方输入关键词发起第一次采集
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">关键词</th>
                <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">状态</th>
                <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">视频数</th>
                <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">leads 数</th>
                <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">创建时间</th>
                <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 text-gray-900 dark:text-white">{(t.keywords ?? []).join('、') || '—'}</td>
                  <td className="py-2"><StatusPill status={t.status} /></td>
                  <td className="py-2 text-gray-700 dark:text-gray-300">{t.video_count}</td>
                  <td className="py-2 text-gray-700 dark:text-gray-300">{t.lead_count_raw}</td>
                  <td className="py-2 text-gray-500 dark:text-gray-400">{t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '—'}</td>
                  <td className="py-2">
                    <Link to={`/area/acquisition/tasks/${t.id}`} className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 text-xs">
                      查看详情 <ChevronRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function VideoCard({ video }: { video: Video }) {
  const [expanded, setExpanded] = useState(false);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (leads !== null) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/acquisition/videos/${encodeURIComponent(video.video_id)}/leads`);
      const j = await r.json();
      if (!j?.success) {
        setError(j?.error?.message || '加载评论失败');
        return;
      }
      setLeads(j.data.leads ?? []);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded bg-slate-100 dark:bg-slate-800 flex-shrink-0 flex items-center justify-center text-xs text-gray-400">
            无封面
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {video.title || '—'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {video.publish_date ? new Date(video.publish_date).toLocaleDateString('zh-CN') : '发布日期未知'}
            {' · '}
            {video.comment_count} 条评论
          </div>
          <a
            href={`https://www.douyin.com/video/${video.video_id}`}
            target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-blue-500 hover:underline"
          >
            来源链接
          </a>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-3">
          {loading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">载入评论中…</div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : !leads || leads.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">暂无评论</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-1.5 text-left text-gray-500 dark:text-gray-400 font-medium">昵称</th>
                  <th className="py-1.5 text-left text-gray-500 dark:text-gray-400 font-medium">留言内容</th>
                  <th className="py-1.5 text-left text-gray-500 dark:text-gray-400 font-medium">AI 分级</th>
                  <th className="py-1.5 text-left text-gray-500 dark:text-gray-400 font-medium">触达状态</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 text-gray-900 dark:text-white">
                      {l.profile_url ? (
                        <a href={l.profile_url} target="_blank" rel="noopener noreferrer" className="text-yellow-500 hover:underline">{l.commenter_id || '—'}</a>
                      ) : (l.commenter_id || '—')}
                    </td>
                    <td className="py-1.5 text-gray-700 dark:text-gray-300">{l.comment_text || '—'}</td>
                    <td className="py-1.5 text-gray-400">{l.grade || '—'}</td>
                    <td className="py-1.5 text-gray-400">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function TaskDetailView({ taskId }: { taskId: string }) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const r = await fetch(`/api/acquisition/collect-tasks/${encodeURIComponent(taskId)}/videos`);
        const j = await r.json();
        if (cancelled) return;
        if (!j?.success) {
          setError(j?.error?.message || '加载视频列表失败');
          return;
        }
        setVideos(j.data.videos ?? []);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  return (
    <div className="max-w-4xl mx-auto py-2 space-y-4">
      <Link to="/area/acquisition/tasks" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <ChevronLeft className="w-4 h-4" /> 返回任务列表
      </Link>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">任务详情</h2>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300 text-sm">{error}</div>
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">载入中…</div>
      ) : !videos || videos.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center rounded-xl border border-slate-200 dark:border-slate-700">
          采集中，稍后刷新查看视频结果
        </div>
      ) : (
        <div className="space-y-2">
          {videos.map((v) => <VideoCard key={v.video_id} video={v} />)}
        </div>
      )}
    </div>
  );
}

export default function AcquisitionTasksPage() {
  const { taskId } = useParams<{ taskId?: string }>();
  return taskId ? <TaskDetailView taskId={taskId} /> : <TaskListView />;
}
