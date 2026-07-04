/**
 * AcquisitionAccountsPage — 智能获客 · 账号管理
 *
 * Line02 获客工作台 IA 重设计 Track A：把 DouyinBurnerBindPage 的绑定部分迁移进来，
 * 采集部分移到 AcquisitionTasksPage。
 */
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';

const MAX_BURNER_ACCOUNTS = 10;

interface BurnerSession {
  account_label: string;
  role: string;
  status: string;
  account_nickname?: string;
  bound_at?: string;
  agent_hostname?: string | null;
  agent_nickname?: string | null;
  agent_status?: string | null;
}

async function fetchSessions(): Promise<BurnerSession[]> {
  const r = await fetch('/api/agent/burner/sessions');
  const j = await r.json();
  return j?.data?.sessions ?? [];
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'needs_rebind') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-900/40 text-red-300">⚠️ 登录过期</span>;
  }
  if (status === 'active') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-300">✅ 正常</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">{status}</span>;
}

export default function AcquisitionAccountsPage() {
  const [sessions, setSessions] = useState<BurnerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [labelError, setLabelError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setSessions(await fetchSessions());
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const atCap = sessions.length >= MAX_BURNER_ACCOUNTS;

  function onLabelChange(v: string) {
    setAccountLabel(v);
    setLabelError(v === 'default' ? 'account_label 不能用 default — 这个名字保留给主号' : '');
  }

  async function handleStartBind() {
    if (!accountLabel || accountLabel === 'default' || atCap) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/agent/burner/qr-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label: accountLabel }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.error?.message || '派 burner 绑定 task 失败');
      } else {
        setAccountLabel('');
        await load();
      }
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-2 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">账号管理</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">管理用于评论触达的抖音小号（与主号 session 物理隔离）。</p>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300 text-sm">{error}</div>
      ) : null}

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">已绑小号（{sessions.length}/{MAX_BURNER_ACCOUNTS}）</h3>

        {sessions.some((s) => s.status === 'needs_rebind') && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3">
            <p className="font-medium text-red-800 dark:text-red-300 text-sm">⚠️ 有小号登录已过期</p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              Cookie 已失效，在下方重新输入该小号名后点"开始绑定"，弹出的 Chrome 窗口里重新扫码登录。
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">载入中…</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">小号名</th>
                  <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">绑定机器</th>
                  <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">绑定时间</th>
                  <th className="py-2 text-left text-gray-500 dark:text-gray-400 font-medium">健康状态</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.account_label} className={`border-b border-slate-100 dark:border-slate-800 ${s.status === 'needs_rebind' ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                    <td className="py-2 text-gray-900 dark:text-white">{s.account_label}</td>
                    <td className="py-2 text-gray-700 dark:text-gray-300" data-testid="machine-hostname-cell">
                      {s.agent_hostname ?? '—'}
                      {s.agent_status === 'offline' && (
                        <span data-testid="machine-status-offline" className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">离线</span>
                      )}
                    </td>
                    <td className="py-2 text-gray-500 dark:text-gray-400">{s.bound_at || '—'}</td>
                    <td className="py-2"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sessions.length === 0 && (
              <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                暂无小号 — 在下方绑定第一个
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-orange-600" />
          绑定新小号
        </h3>
        {atCap ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">
            已达 {MAX_BURNER_ACCOUNTS} 个小号上限，联系升级套餐以绑定更多。
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="account_label（小号名，例：装修小号1）"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              value={accountLabel}
              onChange={(e) => onLabelChange(e.target.value)}
            />
            {labelError ? <div className="text-xs text-red-600">{labelError}</div> : null}
            <button
              type="button"
              disabled={!accountLabel || accountLabel === 'default' || submitting}
              onClick={handleStartBind}
              className="rounded bg-orange-600 px-4 py-2 text-white text-sm disabled:bg-gray-300 dark:disabled:bg-slate-700"
            >
              开始绑定（弹独立 Chrome 扫码）
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
