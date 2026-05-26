import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const OPERATOR_EMAIL = 'xuxiao21xx@icloud.com';

const PLATFORMS = ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号'] as const;
const ACCOUNT_TYPES = ['MAIN', 'SUB_1', 'SUB_2', 'SUB_3'] as const;

type AccountType = typeof ACCOUNT_TYPES[number];
type Platform = typeof PLATFORMS[number];
type SessionStatus = 'ok' | 'expired' | 'missing';

interface SessionCell {
  status: SessionStatus;
  lastSync: string | null;
}

type StatusMatrix = Record<Platform, Record<AccountType, SessionCell>>;

function makeEmptyMatrix(): StatusMatrix {
  const matrix = {} as StatusMatrix;
  for (const p of PLATFORMS) {
    matrix[p] = {} as Record<AccountType, SessionCell>;
    for (const a of ACCOUNT_TYPES) {
      matrix[p][a] = { status: 'missing', lastSync: null };
    }
  }
  return matrix;
}

function StatusBadge({ status }: { status: SessionStatus }) {
  if (status === 'ok') return <span className="inline-flex items-center gap-1 text-green-600 text-xs">🟢 在线</span>;
  if (status === 'expired') return <span className="inline-flex items-center gap-1 text-red-500 text-xs">🔴 离线</span>;
  return <span className="inline-flex items-center gap-1 text-gray-400 text-xs">⚫ 未配置</span>;
}

export default function OperatorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [matrix, setMatrix] = useState<StatusMatrix>(makeEmptyMatrix());
  const [syncing, setSyncing] = useState(false);

  const isOperator = user?.email === OPERATOR_EMAIL;

  useEffect(() => {
    if (!isOperator) {
      navigate('/', { replace: true });
    }
  }, [isOperator, navigate]);

  if (!isOperator) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">未授权：仅限运营员访问</p>
      </div>
    );
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/operator/sessions/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data?.matrix) setMatrix(data.matrix);
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">运营员控制台 — Session 状态矩阵</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          {syncing ? '同步中…' : '立即同步'}
        </button>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-600">平台</th>
              {ACCOUNT_TYPES.map(a => (
                <th key={a} className="border border-gray-200 px-3 py-2 text-center font-medium text-gray-600">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map(platform => (
              <tr key={platform} className="hover:bg-gray-50">
                <td className="border border-gray-200 px-3 py-2 font-medium">{platform}</td>
                {ACCOUNT_TYPES.map(acType => {
                  const cell = matrix[platform][acType];
                  return (
                    <td key={acType} className="border border-gray-200 px-3 py-2 text-center">
                      <StatusBadge status={cell.status} />
                      {cell.lastSync && (
                        <div className="text-gray-400 text-xs mt-1">{cell.lastSync}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
