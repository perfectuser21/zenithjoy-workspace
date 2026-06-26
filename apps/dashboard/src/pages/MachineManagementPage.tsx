/**
 * 机器管理页 — 机器列表 + 主副命名 + 机器下管抖音号 + 在机器上加号
 *
 * Line02 智能获客：运营看自己租户的机器、命名/标主副、点进机器看抖音号、在机器上加号。
 * 所有 fetch 带 credentials:'include'（better-auth cookie 真到达后端 → 按租户 scope）。
 *
 * 接口（apps/api agent-machines 路由）：
 *   GET  /api/agent/machines        机器列表（每台含 douyin_account_count）
 *   GET  /api/agent/machines/:id     机器详情 + 抖音号列表
 *   PUT  /api/agent/machines/:id     改名 + 标主副
 *   POST /api/agent/burner/qr-bind   在机器上加号（复用 agent-burner）
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Monitor, Plus } from 'lucide-react';

interface Machine {
  id: string;
  agent_id: string;
  hostname: string;
  nickname: string;
  machine_role: 'main' | 'sub';
  status: 'online' | 'offline';
  version: string;
  douyin_account_count: number;
}

interface Account {
  account_label: string;
  role: 'main' | 'burner';
  status: string;
  nickname: string;
  valid: boolean;
}

interface MachineDetail {
  machine: Pick<Machine, 'id' | 'nickname' | 'machine_role' | 'status'>;
  accounts: Account[];
}

export default function MachineManagementPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MachineDetail | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const loadMachines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/machines', { credentials: 'include' });
      if (res.status === 401) {
        setError('登录已失效，请重新登录');
        setMachines([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMachines(Array.isArray(data.machines) ? data.machines : []);
    } catch {
      setError('加载机器列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  async function openDetail(id: string) {
    setDetail(null);
    setAddMsg(null);
    const res = await fetch(`/api/agent/machines/${id}`, { credentials: 'include' });
    if (!res.ok) {
      setError('加载机器详情失败');
      return;
    }
    setDetail(await res.json());
  }

  async function saveMachine(id: string, nickname: string, machine_role: 'main' | 'sub') {
    setSaveMsg(null);
    const res = await fetch(`/api/agent/machines/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, machine_role }),
    });
    if (!res.ok) {
      setSaveMsg('保存失败');
      return;
    }
    setSaveMsg('保存成功');
    await loadMachines();
  }

  async function addAccount(machine: Machine) {
    setAddMsg(null);
    const res = await fetch('/api/agent/burner/qr-bind', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: machine.id, account_label: `小号_${Date.now()}` }),
    });
    if (!res.ok) {
      setAddMsg('派单失败，可重试');
      return;
    }
    setAddMsg('已派单到该机器，请在机器上扫码');
  }

  return (
    <div className="p-6" data-testid="machine-management-page">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Monitor size={20} /> 机器管理
        </h1>
        <button
          onClick={loadMachines}
          className="flex items-center gap-1 px-3 py-1 border rounded"
          data-testid="refresh-btn"
        >
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      {error && <div className="text-red-600 mb-3" data-testid="error-msg">{error}</div>}
      {loading && <div data-testid="loading">加载中…</div>}

      <table className="w-full border-collapse" data-testid="machine-table">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2">名称</th>
            <th>hostname</th>
            <th>在线状态</th>
            <th>角色</th>
            <th>抖音号数量</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <MachineRow
              key={m.id}
              machine={m}
              onSave={saveMachine}
              onOpen={() => openDetail(m.id)}
              onAdd={() => addAccount(m)}
            />
          ))}
        </tbody>
      </table>

      {machines.length === 0 && !loading && (
        <div className="text-gray-500 mt-4" data-testid="empty-state">暂无机器</div>
      )}

      {saveMsg && <div className="mt-3 text-green-700" data-testid="save-msg">{saveMsg}</div>}

      {detail && (
        <div className="mt-6 border-t pt-4" data-testid="machine-detail">
          <h2 className="font-semibold mb-2">
            「{detail.machine.nickname}」的抖音号
          </h2>
          {addMsg && <div className="mb-2 text-blue-700" data-testid="add-msg">{addMsg}</div>}
          {detail.accounts.length === 0 ? (
            <div className="text-gray-500" data-testid="detail-empty">该机器暂无抖音号</div>
          ) : (
            <ul data-testid="account-list">
              {detail.accounts.map((a) => (
                <li key={a.account_label} className="py-1" data-testid="account-row">
                  <span className="font-medium">{a.nickname || a.account_label}</span>
                  <span className="ml-2 text-sm">{a.role === 'main' ? '主号' : '小号'}</span>
                  <span className={`ml-2 text-sm ${a.valid ? 'text-green-600' : 'text-red-600'}`}>
                    {a.valid ? '有效' : '已失效，可重新扫码'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MachineRow({
  machine,
  onSave,
  onOpen,
  onAdd,
}: {
  machine: Machine;
  onSave: (id: string, nickname: string, role: 'main' | 'sub') => void;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const [nickname, setNickname] = useState(machine.nickname);
  const [role, setRole] = useState<'main' | 'sub'>(machine.machine_role);
  const offline = machine.status === 'offline';

  return (
    <tr className="border-b" data-testid="machine-row">
      <td className="py-2">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="border rounded px-2 py-1 w-32"
          data-testid="nickname-input"
          aria-label="机器名称"
        />
      </td>
      <td className="text-sm text-gray-600">{machine.hostname}</td>
      <td>
        <span
          className={offline ? 'text-red-600' : 'text-green-600'}
          data-testid="status-badge"
        >
          {offline ? '离线' : '在线'}
        </span>
      </td>
      <td>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'main' | 'sub')}
          className="border rounded px-1 py-1"
          data-testid="role-select"
          aria-label="机器角色"
        >
          <option value="main">主机器</option>
          <option value="sub">副机器</option>
        </select>
      </td>
      <td data-testid="account-count">{machine.douyin_account_count}</td>
      <td className="space-x-2">
        <button
          onClick={() => onSave(machine.id, nickname, role)}
          className="px-2 py-1 border rounded text-sm"
          data-testid="save-btn"
        >
          保存
        </button>
        <button onClick={onOpen} className="px-2 py-1 border rounded text-sm" data-testid="open-btn">
          查看号
        </button>
        <button
          onClick={onAdd}
          disabled={offline}
          title={offline ? '机器离线，无法加号' : '添加抖音号'}
          className={`px-2 py-1 border rounded text-sm inline-flex items-center gap-1 ${
            offline ? 'opacity-40 cursor-not-allowed' : ''
          }`}
          data-testid="add-account-btn"
        >
          <Plus size={14} /> 添加抖音号
        </button>
      </td>
    </tr>
  );
}
