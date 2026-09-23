/**
 * BrainTasksPage — 任务总台（读 Brain task database）
 *
 * 0923 主理人划的范围：**这一页只显示 task database 里的计划**。
 * 留痕（谁跑的/跑多久/烧了多少 token）是另一回事，不在这一页，也不做 UI。
 *
 * 跟 AcquisitionTasksPage 的区别：那一页读的是 ZenithJoy 自己的
 * `/api/acquisition/collect-tasks`（采集任务），这一页读 Brain 的 task database。
 * 两本账，不混在一页 —— 混了就说不清「我在看哪本」。
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Inbox } from 'lucide-react';
import { fetchBrainTasks, type BrainTask } from '../api/brain-tasks.api';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  blocked: '被阻塞',
  cancelled: '已取消',
  canceled: '已取消',
  archived: '已归档',
};

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-gray-700 text-gray-200',
  in_progress: 'bg-blue-900/40 text-blue-300',
  completed: 'bg-green-900/40 text-green-300',
  failed: 'bg-red-900/40 text-red-300',
  blocked: 'bg-amber-900/40 text-amber-300',
  cancelled: 'bg-gray-800 text-gray-400',
  canceled: 'bg-gray-800 text-gray-400',
  archived: 'bg-gray-800 text-gray-500',
};

/** 默认只看还没了结的 —— 这一页的用处是「现在排了什么」，不是翻历史 */
const ACTIVE = ['queued', 'in_progress', 'blocked'];
const ALL = [...ACTIVE, 'completed', 'failed'];

function fmt(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function BrainTasksPage() {
  const [tasks, setTasks] = useState<BrainTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  async function load(which: 'active' | 'all') {
    setLoading(true);
    setErr('');
    try {
      const rows = await fetchBrainTasks(which === 'active' ? ACTIVE : ALL, { limit: 100 });
      rows.sort((a, b) => {
        // 有截止时间的排前面，按截止时间升序；没有的按入队时间降序
        const ad = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
        const bd = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return Date.parse(b.queued_at || b.updated_at || '0') - Date.parse(a.queued_at || a.updated_at || '0');
      });
      setTasks(rows);
      setFetchedAt(new Date());
    } catch (e) {
      // 关键：失败就说失败，绝不退化成一张空表。
      // 空表和读不到长得一样，人会以为「今天没排活」，实际是后台断了。
      setErr(String((e as Error)?.message || e));
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(scope);
  }, [scope]);

  const byType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tasks) {
      const k = t.task_type || '(未标类型)';
      m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  return (
    <div className="p-6 text-gray-100">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-xl font-semibold">任务总台</h1>
          <p className="text-sm text-gray-400 mt-1">
            Brain task database 里排着的活。这一页只看计划，不看执行留痕。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-md overflow-hidden border border-gray-700">
            <button
              onClick={() => setScope('active')}
              className={`px-3 py-1.5 text-sm ${scope === 'active' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-400'}`}
            >
              未了结
            </button>
            <button
              onClick={() => setScope('all')}
              className={`px-3 py-1.5 text-sm ${scope === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-400'}`}
            >
              含已完成
            </button>
          </div>
          <button
            onClick={() => load(scope)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-4">
        {fetchedAt ? `数据截至 ${fmt(fetchedAt.toISOString())}` : '数据截至 —'}
        {tasks.length > 0 && (
          <span className="ml-3">
            共 {tasks.length} 条 · {byType.map(([k, n]) => `${k} ${n}`).join(' · ')}
          </span>
        )}
      </div>

      {err && (
        <div className="flex items-start gap-2 p-4 mb-4 bg-red-900/20 border border-red-800 rounded-md">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="text-red-300 font-medium">读取失败 · 下面不是真的</div>
            <div className="text-red-400/80 mt-1 font-mono text-xs">{err}</div>
            <div className="text-gray-400 mt-1">
              排程后台没连通时这里会空——空表和读不到长得一样，所以宁可报错也不给你看一张假的空表。
            </div>
          </div>
        </div>
      )}

      {!err && !loading && tasks.length === 0 && (
        <div className="flex items-center gap-2 p-6 bg-gray-900 border border-gray-800 rounded-md text-gray-400">
          <Inbox className="w-4 h-4" />
          <span>暂无任务（接口通，确实一条都没排）</span>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="overflow-x-auto border border-gray-800 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">状态</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">类型</th>
                <th className="text-left px-3 py-2 font-medium">任务</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">客户</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">谁派的</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">谁在做</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">截止</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-gray-800 hover:bg-gray-900/50 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[t.status] || 'bg-gray-800 text-gray-300'}`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400 font-mono">
                    {t.task_type || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-100">{t.title}</div>
                    {t.error_message && (
                      <div className="text-xs text-red-400/90 mt-1 font-mono break-all">
                        {t.error_message.slice(0, 160)}
                      </div>
                    )}
                    {(t.retry_count ?? 0) > 0 && (
                      <div className="text-xs text-amber-400/80 mt-1">已重试 {t.retry_count} 次</div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">{t.tenant_id || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">{t.trigger_source || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">
                    {t.claimed_by || '—'}
                    {t.claimed_at && <div className="text-gray-600">{fmt(t.claimed_at)}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">{fmt(t.due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
