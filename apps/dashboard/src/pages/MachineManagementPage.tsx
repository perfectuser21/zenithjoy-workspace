/**
 * MachineManagementPage — Line02 机器管理页（智能获客板块）
 *
 * 运营在这里：看本租户机器列表（名称/在线/主副/抖音号数）→ 给机器命名+标主副保存 →
 * 点进机器看抖音号列表（主号/小号 + 有效性）→ 在机器上「添加抖音号」（派 qr-bind 单，
 * fake-agent/真 Agent 扫码回写后号出现在该机器下）。
 *
 * 后端：GET/PUT /api/agent/machines(:id) + POST /:id/add-douyin（agent-machines.ts）。
 * 鉴权走 better-auth session cookie（credentials:'include'），tenant 由后端 session 解析。
 */
import { useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface Machine {
  id: string;
  nickname: string | null;
  hostname: string | null;
  status: 'online' | 'offline';
  version: string | null;
  machine_role: 'main' | 'sub';
  douyin_account_count: number;
}

interface DouyinSession {
  account_label: string;
  role: 'main' | 'burner';
  status: string;
  valid: boolean;
  account_nickname: string | null;
  bound_at: string | null;
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  const body = await r.json();
  return body.data as T;
}

async function apiSend<T>(path: string, method: string, payload: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}`);
  const body = await r.json();
  return body.data as T;
}

const roleLabel = (r: 'main' | 'sub') => (r === 'main' ? '主机器' : '副机器');

export default function MachineManagementPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 行内编辑态：每台机器一个草稿名 + 草稿主副
  const [draftName, setDraftName] = useState<Record<string, string>>({});
  const [draftRole, setDraftRole] = useState<Record<string, 'main' | 'sub'>>({});

  // 详情面板
  const [openId, setOpenId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DouyinSession[]>([]);
  const [newLabel, setNewLabel] = useState('');

  const loadMachines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ machines: Machine[] }>('/agent/machines');
      setMachines(data.machines || []);
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const saveMachine = async (m: Machine) => {
    const nickname = draftName[m.id] ?? m.nickname ?? '';
    const machine_role = draftRole[m.id] ?? m.machine_role;
    try {
      await apiSend(`/agent/machines/${m.id}`, 'PUT', { nickname, machine_role });
      flashToast('保存成功');
      await loadMachines();
    } catch {
      flashToast('保存失败');
    }
  };

  const openDetail = async (id: string) => {
    setOpenId(id);
    setSessions([]);
    setNewLabel('');
    try {
      const data = await apiGet<{ machine: Machine; sessions: DouyinSession[] }>(
        `/agent/machines/${id}`,
      );
      setSessions(data.sessions || []);
    } catch {
      flashToast('详情加载失败');
    }
  };

  const addDouyin = async (id: string) => {
    const label = newLabel.trim();
    if (!label) {
      flashToast('请填写抖音号备注');
      return;
    }
    try {
      await apiSend(`/agent/machines/${id}/add-douyin`, 'POST', { account_label: label });
      flashToast('已派扫码任务');
      // 派单后刷新详情（真/fake Agent 回写后新号出现）
      await openDetail(id);
    } catch {
      flashToast('添加失败');
    }
  };

  return (
    <div className="p-6" data-testid="machine-management-page">
      <h1 className="text-2xl font-bold mb-1">机器管理</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-4">
        管理客户机器与机器上绑定的抖音号：命名、标主副、查看号、加号扫码。
      </p>

      {toast && (
        <div
          data-testid="machine-toast"
          className="mb-4 inline-block rounded bg-green-100 px-3 py-1 text-green-700"
        >
          {toast}
        </div>
      )}

      {loading && <div>加载中…</div>}
      {error && <div className="text-red-500">{error}</div>}

      {!loading && !error && machines.length === 0 && (
        <div className="text-gray-400">本租户暂无机器，请先在客户 PC 安装 Agent。</div>
      )}

      <div className="space-y-3">
        {machines.map((m) => {
          const offline = m.status === 'offline';
          const name = (draftName[m.id] ?? m.nickname) || '';
          const role = draftRole[m.id] ?? m.machine_role;
          return (
            <div
              key={m.id}
              data-testid="machine-row"
              className={`rounded border p-4 ${
                offline ? 'border-red-300 bg-red-50' : 'border-gray-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="font-semibold min-w-[140px]">
                  {m.nickname || m.hostname || m.id.slice(0, 8)}
                </div>
                <div
                  data-testid="machine-status"
                  className={offline ? 'text-red-500 font-medium' : 'text-green-600 font-medium'}
                >
                  {offline ? '离线' : '在线'}
                </div>
                <div data-testid="machine-role">{roleLabel(m.machine_role)}</div>
                <div data-testid="machine-account-count" className="text-gray-600">
                  抖音号 {m.douyin_account_count}
                </div>
                <div className="text-gray-400 text-sm">{m.hostname}</div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  data-testid="machine-nickname-input"
                  className="rounded border px-2 py-1 text-sm"
                  placeholder="机器名称"
                  value={name}
                  onChange={(e) => setDraftName((s) => ({ ...s, [m.id]: e.target.value }))}
                />
                <select
                  data-testid="machine-role-select"
                  className="rounded border px-2 py-1 text-sm"
                  value={role}
                  onChange={(e) =>
                    setDraftRole((s) => ({ ...s, [m.id]: e.target.value as 'main' | 'sub' }))
                  }
                >
                  <option value="main">主机器</option>
                  <option value="sub">副机器</option>
                </select>
                <button
                  data-testid="machine-save-btn"
                  className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
                  onClick={() => saveMachine(m)}
                >
                  保存
                </button>
                <button
                  data-testid="machine-detail-btn"
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() => openDetail(m.id)}
                >
                  查看抖音号
                </button>
              </div>

              {openId === m.id && (
                <div data-testid="machine-detail" className="mt-3 border-t pt-3">
                  <div className="mb-2 font-medium">抖音号列表</div>
                  {sessions.length === 0 && (
                    <div className="text-gray-400 text-sm">该机器暂无抖音号</div>
                  )}
                  <ul className="space-y-1">
                    {sessions.map((s) => (
                      <li
                        key={s.account_label}
                        data-testid="douyin-session-row"
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="font-medium">{s.account_nickname || s.account_label}</span>
                        <span>{s.role === 'main' ? '主号' : '小号'}</span>
                        <span className={s.valid ? 'text-green-600' : 'text-red-500'}>
                          {s.valid ? '有效' : '失效'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      data-testid="add-douyin-input"
                      className="rounded border px-2 py-1 text-sm"
                      placeholder="抖音号备注（如 小号A）"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                    />
                    <button
                      data-testid="add-douyin-btn"
                      className="rounded bg-pink-600 px-3 py-1 text-sm text-white"
                      onClick={() => addDouyin(m.id)}
                    >
                      添加抖音号
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
