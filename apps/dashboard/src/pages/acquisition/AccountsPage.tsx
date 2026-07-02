import { useEffect, useState } from 'react';
import { RefreshCw, Plus, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

const MAX_SESSIONS = 10;

interface BurnerSession {
  id?: string;
  account_label: string;
  account_nickname?: string;
  status: string;
  bound_at?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: typeof CheckCircle }> = {
  active:       { label: 'ok',      color: 'text-green-400',  Icon: CheckCircle   },
  needs_rebind: { label: 'expired', color: 'text-yellow-400', Icon: AlertTriangle },
  banned:       { label: 'banned',  color: 'text-red-400',    Icon: XCircle       },
};

async function fetchSessions(): Promise<BurnerSession[]> {
  const res = await fetch('/api/agent/burner/sessions');
  if (!res.ok) return [];
  const body = await res.json() as { success: boolean; data?: { sessions?: BurnerSession[] } };
  return body?.data?.sessions ?? [];
}

export default function AccountsPage() {
  const [sessions, setSessions] = useState<BurnerSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [bindLoading, setBindLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSessions(await fetchSessions());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const handleBind = async () => {
    setBindLoading(true);
    setError(null);
    setQrUrl(null);
    try {
      const res = await fetch('/api/agent/burner/qr-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label: `burner-${Date.now()}` }),
      });
      if (res.status === 503) {
        showToast('当前无在线 Agent，请稍后重试');
        return;
      }
      if (!res.ok) {
        showToast(`绑定失败（HTTP ${res.status}），请重试`);
        return;
      }
      const body = await res.json() as { data?: { qr_url?: string } };
      setQrUrl(body?.data?.qr_url ?? null);
    } catch {
      showToast('网络错误，请重试');
    } finally {
      setBindLoading(false);
    }
  };

  const atLimit = sessions.length >= MAX_SESSIONS;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">账号管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <div title={atLimit ? `已达 ${MAX_SESSIONS} 个小号上限，请升级套餐` : ''}>
            <button
              data-testid="bind-new-account-btn"
              onClick={handleBind}
              disabled={atLimit || bindLoading}
              className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                atLimit
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-yellow-500/20 text-yellow-300 border border-yellow-600/40 hover:bg-yellow-500/30'
              }`}
            >
              <Plus size={14} />
              {bindLoading ? '请求中…' : '绑定新小号'}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="mb-4 p-3 bg-orange-900/30 text-orange-300 rounded text-sm">{toast}</div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded text-sm">{error}</div>
      )}

      {qrUrl && (
        <div className="mb-6 p-4 rounded-xl border border-yellow-700/40 bg-slate-800/60 text-center">
          <p className="text-sm text-gray-400 mb-3">请用手机扫码绑定抖音小号</p>
          <img src={qrUrl} alt="绑定二维码" className="mx-auto max-w-xs" />
        </div>
      )}

      {sessions.length === 0 ? (
        <div
          data-testid="accounts-empty"
          className="flex flex-col items-center justify-center py-16 text-gray-500"
        >
          <p className="mb-2">暂无已绑定的抖音小号</p>
          <p className="text-sm">点击右上角「绑定新小号」开始添加</p>
        </div>
      ) : (
        <div data-testid="accounts-list" className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/80">
              <tr className="text-left text-gray-400">
                <th className="px-4 py-3">账号昵称</th>
                <th className="px-4 py-3">绑定时间</th>
                <th className="px-4 py-3">健康状态</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const cfg = STATUS_CONFIG[s.status] ?? { label: s.status, color: 'text-gray-400', Icon: AlertTriangle };
                const { Icon } = cfg;
                return (
                  <tr key={s.id ?? i} className="border-t border-slate-700/50 hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-white">{s.account_nickname ?? s.account_label}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {s.bound_at ? new Date(s.bound_at).toLocaleString('zh-CN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 ${cfg.color}`}>
                        <Icon size={14} />
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {atLimit && (
            <div className="px-4 py-2 bg-orange-900/20 text-orange-400 text-xs border-t border-orange-800/30">
              已达 {MAX_SESSIONS} 个小号上限，如需更多请升级套餐
            </div>
          )}
        </div>
      )}
    </div>
  );
}
