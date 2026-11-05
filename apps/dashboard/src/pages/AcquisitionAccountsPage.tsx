/**
 * AcquisitionAccountsPage — 智能获客 · 账号管理
 *
 * Line02 获客工作台 IA 重设计 Track A：把 DouyinBurnerBindPage 的绑定部分迁移进来，
 * 采集部分移到 AcquisitionTasksPage。
 */
import { useEffect, useState } from 'react';

interface BurnerSession {
  account_label: string;
  role: string;
  status: string;
  account_nickname?: string;
  bound_at?: string;
  agent_id?: string | null;
  agent_hostname?: string | null;
  agent_nickname?: string | null;
  agent_status?: string | null;
  device_type?: 'web' | 'android' | null;
}

interface WarmupLiveness {
  nickname: string;
  alive: boolean;
  followers: number | null;
  reason?: string | null;
  checked_at?: string | null;
}

async function fetchSessions(): Promise<BurnerSession[]> {
  const r = await fetch('/api/agent/burner/sessions');
  const j = await r.json();
  if (!r.ok || j?.success !== true || !Array.isArray(j?.data?.sessions)) throw new Error('账号历史读取失败，请稍后重试');
  return j.data.sessions;
}

/**
 * Line02 养号验活面板：某 agent（设备）最近一次每号活/掉线（掉线标红）+ 粉丝 + 验活时间。
 * 设备级按真实抖音昵称展示（account_label↔昵称无映射，故按 warmup 读到的真实昵称）。
 * 无验活记录 → 返回 null（不占位）。
 */
export function WarmupLivenessPanel({ agentId, hostname }: { agentId: string; hostname?: string | null }) {
  const [rows, setRows] = useState<WarmupLiveness[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    (async () => {
      try {
        const r = await fetch(`/api/agent/burner/warmup-liveness?agent_id=${encodeURIComponent(agentId)}`);
        const j = await r.json();
        if (!r.ok || j?.success !== true || !Array.isArray(j?.data?.liveness)) throw new Error('invalid response');
        if (alive) setRows(j.data.liveness);
      } catch {
        if (alive) { setRows([]); setError(true); }
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [agentId]);

  if (!loaded) return null;
  if (error) return <div role="alert" className="mt-3 text-sm text-red-600">验活历史读取失败，请稍后重试</div>;
  if (rows.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
        养号验活 · {hostname ?? agentId}
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.nickname}
            data-alive={r.alive ? 'true' : 'false'}
            className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
              r.alive ? '' : 'bg-red-50 dark:bg-red-900/20'
            }`}
          >
            <span className={r.alive ? 'text-gray-900 dark:text-white' : 'text-red-700 dark:text-red-300 font-medium'}>
              {r.alive ? '✅' : '🔴'} {r.nickname}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {r.followers != null ? `${r.followers} 粉` : '粉丝未知'}
              {r.checked_at ? ` · ${new Date(r.checked_at).toLocaleString()}` : ''}
              {!r.alive ? ' · 掉线，去手机重登' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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

  return (
    <div className="max-w-3xl mx-auto py-2 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">账号管理</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">旧版获客已停用，可继续查看历史账号状态。</p>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300 text-sm">{error}</div>
      ) : null}

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">历史账号{error ? '' : `（${sessions.length}）`}</h3>

        {sessions.some((s) => s.status === 'needs_rebind') && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-3">
            <p className="font-medium text-red-800 dark:text-red-300 text-sm">⚠️ 有小号登录已过期</p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              旧版账号登录状态已过期。
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">载入中…</div>
        ) : error ? null : (
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
                      {s.device_type === 'android' && (
                        <span className="ml-1 text-xs text-gray-400" title="安卓设备扫描">📱</span>
                      )}
                      {s.device_type === 'web' && (
                        <span className="ml-1 text-xs text-gray-400" title="Web 小号会话">🖥️</span>
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
                暂无历史小号
              </div>
            )}
            {/* 每个绑定设备一个养号验活面板（有验活记录才显示，掉线号标红）*/}
            {Array.from(
              new Map(
                sessions
                  .filter((s) => s.agent_id)
                  .map((s) => [s.agent_id as string, s.agent_hostname ?? null] as const),
              ).entries(),
            ).map(([agentId, hostname]) => (
              <WarmupLivenessPanel key={agentId} agentId={agentId} hostname={hostname} />
            ))}
          </>
        )}
      </section>


    </div>
  );
}
