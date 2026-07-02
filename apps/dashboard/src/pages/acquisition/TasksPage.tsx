import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, Search, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

interface CollectTask {
  id: string;
  keywords: string[];
  status: string;
  video_count: number;
  lead_count_raw: number;
  created_at: string;
  error_code?: string | null;
}

interface VideoCard {
  video_id: string;
  task_id: string;
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
  keyword: string;
  profile_url: string | null;
  crawled_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending:  '等待中',
  running:  '采集中',
  done:     '已完成',
  partial:  '部分完成',
  failed:   '失败',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<string, string> = {
  pending:  'text-yellow-400',
  running:  'text-blue-400',
  done:     'text-green-400',
  partial:  'text-orange-400',
  failed:   'text-red-400',
  cancelled: 'text-gray-400',
};

const ERROR_LABEL: Record<string, string> = {
  agent_offline:   'Agent 离线，请检查客户端连接',
  no_burner:       '无可用小号，请先绑定小号',
  COLLECT_TIMEOUT: '采集超时，任务已超时终止',
};

async function fetchTasks(): Promise<CollectTask[]> {
  const res = await fetch('/api/acquisition/collect-tasks');
  if (!res.ok) return [];
  const body = await res.json() as { success: boolean; data?: { tasks?: CollectTask[] } };
  return body?.data?.tasks ?? [];
}

async function fetchVideos(taskId: string): Promise<VideoCard[]> {
  const res = await fetch(`/api/acquisition/collect-tasks/${taskId}/videos`);
  if (!res.ok) return [];
  const body = await res.json() as { success: boolean; data?: { videos?: VideoCard[] } };
  return body?.data?.videos ?? [];
}

async function fetchLeads(videoId: string): Promise<Lead[]> {
  const res = await fetch(`/api/acquisition/videos/${videoId}/leads`);
  if (!res.ok) return [];
  const body = await res.json() as { success: boolean; data?: { leads?: Lead[] } };
  return body?.data?.leads ?? [];
}

// ── 二级：视频卡片 + leads 展开 ──────────────────────────
function TaskDetailView({ taskId }: { taskId: string }) {
  const [videos, setVideos] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);
  const [leadsMap, setLeadsMap] = useState<Record<string, Lead[]>>({});
  const [leadsLoading, setLeadsLoading] = useState(false);

  useEffect(() => {
    fetchVideos(taskId).then((vs) => { setVideos(vs); setLoading(false); });
  }, [taskId]);

  const toggleVideo = async (videoId: string) => {
    if (expandedVideoId === videoId) { setExpandedVideoId(null); return; }
    setExpandedVideoId(videoId);
    if (leadsMap[videoId]) return;
    setLeadsLoading(true);
    const leads = await fetchLeads(videoId);
    setLeadsMap((m) => ({ ...m, [videoId]: leads }));
    setLeadsLoading(false);
  };

  if (loading) {
    return (
      <div data-testid="video-cards-container" className="p-6 text-gray-400 text-sm">
        加载中…
      </div>
    );
  }

  return (
    <div data-testid="video-cards-container" className="p-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-white mb-4">视频列表</h2>
      {videos.length === 0 ? (
        <div className="text-gray-500 text-sm py-8 text-center">暂无视频数据</div>
      ) : (
        <div className="space-y-3">
          {videos.map((v) => (
            <div
              key={v.video_id}
              data-testid="video-card"
              className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"
            >
              <button
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-700/30"
                onClick={() => toggleVideo(v.video_id)}
              >
                {v.thumbnail_url ? (
                  <img
                    src={v.thumbnail_url}
                    alt={v.title ?? v.video_id}
                    className="w-16 h-12 object-cover rounded"
                  />
                ) : (
                  <div className="w-16 h-12 bg-slate-700 rounded flex items-center justify-center text-gray-500 text-xs">
                    无封面
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">
                    {v.title ?? (
                      <a
                        href={`https://v.douyin.com/${v.video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v.video_id}
                      </a>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {v.publish_date ? new Date(v.publish_date).toLocaleDateString('zh-CN') : '日期未知'} ·{' '}
                    {v.comment_count} 条评论
                  </p>
                </div>
                {expandedVideoId === v.video_id ? (
                  <ChevronDown size={16} className="text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-gray-400 shrink-0" />
                )}
              </button>

              {expandedVideoId === v.video_id && (
                <div className="border-t border-slate-700 px-4 py-3">
                  {leadsLoading ? (
                    <div className="text-gray-400 text-sm py-2">加载 leads…</div>
                  ) : !leadsMap[v.video_id] || leadsMap[v.video_id].length === 0 ? (
                    <div data-testid="leads-empty-placeholder" className="text-gray-500 text-sm py-2 text-center">
                      暂无评论
                    </div>
                  ) : (
                    <ul data-testid="leads-list" className="space-y-2">
                      {leadsMap[v.video_id].map((l, i) => (
                        <li key={i} className="text-sm text-gray-300">
                          <span className="font-medium text-white">{l.commenter_id}</span>
                          {' '}— {l.comment_text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 一级：任务列表 ───────────────────────────────────────
export default function TasksPage() {
  const { taskId } = useParams<{ taskId?: string }>();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<CollectTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setTasks(await fetchTasks()); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleStart = async () => {
    if (!keyword.trim()) return;
    setStartLoading(true);
    setStartError(null);
    try {
      const res = await fetch('/api/acquisition/collect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [keyword.trim()] }),
      });
      if (res.status === 503) { setStartError('当前无在线 Agent 或小号，请检查后重试'); return; }
      if (!res.ok) {
        const body = await res.json() as { error?: { code?: string } };
        setStartError(body?.error?.code ?? `HTTP ${res.status}`);
        return;
      }
      setKeyword('');
      await load();
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStartLoading(false);
    }
  };

  const handleRetry = async (t: CollectTask) => {
    const kw = Array.isArray(t.keywords) ? t.keywords[0] : '';
    if (!kw) return;
    await fetch('/api/acquisition/collect/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: t.keywords }),
    });
    await load();
  };

  // 二级路由（/:taskId）
  if (taskId) {
    return <TaskDetailView taskId={taskId} />;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">采集任务</h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 关键词输入 + 开始采集 */}
      <div className="flex gap-2 mb-6">
        <input
          data-testid="keyword-input"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleStart()}
          placeholder="输入关键词，例：装修、瓷砖"
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
        />
        <button
          data-testid="start-collect-btn"
          onClick={handleStart}
          disabled={startLoading || !keyword.trim()}
          className="flex items-center gap-1 px-4 py-2 rounded text-sm font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-600/40 hover:bg-yellow-500/30 disabled:opacity-50"
        >
          <Search size={14} />
          {startLoading ? '派发中…' : '开始采集'}
        </button>
      </div>

      {startError && (
        <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded text-sm">{startError}</div>
      )}

      {/* 任务列表 */}
      <div data-testid="tasks-list" className="rounded-xl border border-slate-700 overflow-hidden">
        {tasks.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-500 text-sm">暂无采集任务</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-800/80">
              <tr className="text-left text-gray-400">
                <th className="px-4 py-3">关键词</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">视频数</th>
                <th className="px-4 py-3">线索数</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  data-testid="task-row"
                  className="border-t border-slate-700/50 hover:bg-slate-800/30 cursor-pointer"
                  onClick={() => navigate(`/area/acquisition/tasks/${t.id}`)}
                >
                  <td className="px-4 py-3 text-white">
                    {Array.isArray(t.keywords) ? t.keywords.join('、') : t.keywords}
                  </td>
                  <td className="px-4 py-3">
                    {t.status === 'failed' ? (
                      <div>
                        <span data-testid="task-status-failed" className={`${STATUS_COLOR.failed} text-xs font-medium`}>
                          ✗ {STATUS_LABEL.failed}
                        </span>
                        {t.error_code && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {ERROR_LABEL[t.error_code] ?? t.error_code}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className={`${STATUS_COLOR[t.status] ?? 'text-gray-400'} text-xs font-medium`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{t.video_count}</td>
                  <td className="px-4 py-3 text-gray-300">{t.lead_count_raw}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {t.status === 'failed' && (
                      <button
                        data-testid="task-retry-btn"
                        onClick={() => handleRetry(t)}
                        className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300"
                      >
                        <RotateCcw size={12} />
                        重新采集
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
