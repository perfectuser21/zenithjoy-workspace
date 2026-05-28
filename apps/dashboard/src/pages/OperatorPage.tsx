import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const OPERATOR_EMAIL = 'xuxiao21xx@icloud.com';

const PLATFORMS = [
  { key: 'douyin', label: '抖音' },
  { key: 'kuaishou', label: '快手' },
  { key: 'xiaohongshu', label: '小红书' },
  { key: 'shipinhao', label: '视频号' },
  { key: 'toutiao', label: '头条' },
  { key: 'weibo', label: '微博' },
  { key: 'zhihu', label: '知乎' },
  { key: 'gongzhonghao', label: '公众号' },
] as const;

type PlatformKey = typeof PLATFORMS[number]['key'];
type SessionStatus = 'active' | 'expired' | 'missing';

interface SessionRow {
  platform: PlatformKey;
  secretName: string;
  status: SessionStatus;
  lastCheckedAt: string | null;
  lastValidAt: string | null;
}

function StatusBadge({ status }: { status: SessionStatus }) {
  if (status === 'active') return <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">🟢 在线</span>;
  if (status === 'expired') return <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium">🔴 离线</span>;
  return <span className="inline-flex items-center gap-1 text-gray-400 text-xs font-medium">⚫ 未配置</span>;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function OperatorPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [bindingPlatform, setBindingPlatform] = useState<string | null>(null);

  const isOperator = user?.email === OPERATOR_EMAIL;

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/operator/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {
      // fetch failed, keep current state
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isOperator) {
      navigate('/', { replace: true });
      return;
    }
    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, [authLoading, isOperator, navigate, fetchSessions]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">加载中…</p>
      </div>
    );
  }

  if (!isOperator) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">未授权：仅限运营员访问</p>
      </div>
    );
  }

  async function handleLogin(platformKey: string) {
    setBindingPlatform(platformKey);
    try {
      await fetch('/api/operator/sessions/trigger-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformKey }),
      });
    } finally {
      setBindingPlatform(null);
      await fetchSessions();
    }
  }

  const sessionMap = new Map(sessions.map((s) => [s.platform, s]));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">运营员控制台 — Session 健康监控</h1>
        <span className="text-xs text-gray-400">每 30 秒自动刷新</span>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-4 py-2 text-left font-medium text-gray-600">平台</th>
              <th className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600">状态</th>
              <th className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600">最近检查</th>
              <th className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600">最近有效</th>
              <th className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map(({ key, label }) => {
              const row = sessionMap.get(key);
              const status: SessionStatus = row?.status ?? 'missing';
              const lastCheckedAt = row?.lastCheckedAt ?? null;
              const lastValidAt = row?.lastValidAt ?? null;
              const isBinding = bindingPlatform === key;

              return (
                <tr key={key} className="hover:bg-gray-50">
                  <td className="border border-gray-200 px-4 py-3 font-medium">{label}</td>
                  <td className="border border-gray-200 px-4 py-3 text-center">
                    <StatusBadge status={status} />
                  </td>
                  <td className="border border-gray-200 px-4 py-3 text-center text-xs text-gray-500">
                    {formatTime(lastCheckedAt)}
                  </td>
                  <td className="border border-gray-200 px-4 py-3 text-center text-xs text-gray-500">
                    {formatTime(lastValidAt)}
                  </td>
                  <td className="border border-gray-200 px-4 py-3 text-center">
                    <button
                      onClick={() => handleLogin(key)}
                      disabled={isBinding}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isBinding ? '绑定中…' : '登录'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
