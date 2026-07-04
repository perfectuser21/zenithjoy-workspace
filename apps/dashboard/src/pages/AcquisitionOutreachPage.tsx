import { useEffect, useState } from 'react';
import { fetchOutreachHistory, type OutreachHistoryItem } from '../api/acquisition-dispatch.api';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队',
  dispatched: '已派发',
  sent: '已发送',
  limited: '限流',
  failed: '失败',
};

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleString('zh-CN', { hour12: false });
}

export default function AcquisitionOutreachPage() {
  const [items, setItems] = useState<OutreachHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchOutreachHistory()
      .then((result) => {
        if (alive) setItems(result.items);
      })
      .catch(() => {
        if (alive) setError(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto py-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">触达记录</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">查看私信触达历史：Lead 昵称、指派小号、排期时间和发送状态。</p>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">加载中…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">暂无触达记录，触达任务运行后将在此显示</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Lead 昵称</th>
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">指派小号</th>
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">排期时间</th>
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">发送时间</th>
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-3 px-4 text-gray-900 dark:text-white">{item.lead_nickname || '—'}</td>
                  <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{item.account_label}</td>
                  <td className="py-3 px-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatTime(item.scheduled_for)}</td>
                  <td className="py-3 px-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatTime(item.sent_at)}</td>
                  <td className="py-3 px-4">{STATUS_LABEL[item.status] ?? item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
