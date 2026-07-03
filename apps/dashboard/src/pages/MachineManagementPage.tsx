/**
 * 机器管理页 — /dashboard/machines（Line02 智能获客板块下）
 *
 * 列表：本租户机器（hostname/nickname + online绿/offline红 + 主/副标签 + version
 *       + last_seen + session_count「N 个号」）。点机器行 → 详情。
 * 详情：该机器抖音号列表 + 「重命名」「设为主/副机器」（PUT）+「添加抖音号」（派 qr-bind 单）。
 *
 * 契约见 sprints/06260400-machine-management/contract.md。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMachines,
  fetchMachineDetail,
  updateMachine,
  dispatchQrBind,
  type Machine,
  type MachineDetail,
} from '../api/machines.api';
import {
  fetchMachineEvents,
  type MachineEvents,
  type LogEvent,
} from '../api/machine-events.api';

const DOT_ONLINE = '\u{1F7E2}'; // 绿点
const DOT_OFFLINE = '\u{1F534}'; // 红点

function StatusBadge({ status }: { status: Machine['status'] }) {
  const online = status === 'online';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        online ? 'text-green-600' : 'text-red-500'
      }`}
    >
      <span aria-hidden="true">{online ? DOT_ONLINE : DOT_OFFLINE}</span>
      <span>{online ? '在线' : '离线'}</span>
    </span>
  );
}

function RoleBadge({ role }: { role: Machine['machine_role'] }) {
  const main = role === 'main';
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        main ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {main ? '主机' : '副机'}
    </span>
  );
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleString('zh-CN', { hour12: false });
}

// ============ 列表视图 ============
function MachineList({
  machines,
  onSelect,
}: {
  machines: Machine[];
  onSelect: (id: string) => void;
}) {
  if (machines.length === 0) {
    return (
      <div className="rounded border border-gray-200 px-4 py-10 text-center text-gray-400">
        暂无已注册机器
      </div>
    );
  }
  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            <th className="border border-gray-200 px-4 py-2 text-left font-medium">机器</th>
            <th className="border border-gray-200 px-4 py-2 text-left font-medium">状态</th>
            <th className="border border-gray-200 px-4 py-2 text-left font-medium">角色</th>
            <th className="border border-gray-200 px-4 py-2 text-left font-medium">版本</th>
            <th className="border border-gray-200 px-4 py-2 text-left font-medium">抖音号</th>
            <th className="border border-gray-200 px-4 py-2 text-left font-medium">最后在线</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr
              key={m.id}
              className="cursor-pointer hover:bg-blue-50"
            >
              <td className="border border-gray-200 px-4 py-3">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onSelect(m.id)}
                >
                  <div className="font-medium">{m.nickname || m.hostname}</div>
                  <div className="text-xs text-gray-400">{m.hostname}</div>
                </button>
              </td>
              <td className="border border-gray-200 px-4 py-3">
                <StatusBadge status={m.status} />
              </td>
              <td className="border border-gray-200 px-4 py-3">
                <RoleBadge role={m.machine_role} />
              </td>
              <td className="border border-gray-200 px-4 py-3 font-mono text-xs text-gray-700">
                {m.version || '—'}
              </td>
              <td className="border border-gray-200 px-4 py-3">{m.session_count} 个号</td>
              <td className="border border-gray-200 px-4 py-3 text-xs text-gray-500">
                {formatTime(m.last_seen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============ 模块与日志块（观测事件） ============
function logLevelClass(level: LogEvent['level']): string {
  switch (level) {
    case 'error':
      return 'text-red-600';
    case 'warn':
      return 'text-yellow-600';
    default:
      return 'text-gray-500';
  }
}

function clampPercent(p: number | null): number {
  if (p == null || Number.isNaN(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

const REFRESH_MS = 10_000;

function MachineEventsSection({ machineId }: { machineId: string }) {
  const [events, setEvents] = useState<MachineEvents>({ logs: [], upgrades: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMachineEvents(machineId, { limit: 50 });
      setEvents(data);
      setError(null);
    } catch {
      setError('加载模块与日志失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS); // 自动轮询 10s
    return () => clearInterval(t);
  }, [load]);

  const { logs, upgrades } = events;

  return (
    <section className="rounded border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium">模块与日志</h3>
        <button
          type="button"
          onClick={load}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
        >
          刷新
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {/* 升级进度 */}
      <div className="mb-5">
        <div className="mb-2 text-sm font-medium text-gray-700">升级进度</div>
        {loading && upgrades.length === 0 ? (
          <div className="text-sm text-gray-400">加载中…</div>
        ) : upgrades.length === 0 ? (
          <div className="text-sm text-gray-400">暂无升级记录</div>
        ) : (
          <ul className="space-y-3">
            {upgrades.map((u) => {
              const pct = clampPercent(u.percent);
              return (
                <li key={u.id} className="rounded border border-gray-100 p-3">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{u.module || '—'}</span>
                    <span className="text-xs text-gray-500">
                      {u.phase || '—'} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
                    <div
                      data-testid={`upgrade-bar-${u.id}`}
                      className={`h-2 rounded ${
                        u.phase === 'failed' ? 'bg-red-500' : 'bg-blue-600'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {u.message ? (
                    <div className="mt-1 text-xs text-gray-600">{u.message}</div>
                  ) : null}
                  <div className="mt-1 text-xs text-gray-400">{formatTime(u.created_at)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 最近错误 / 日志 */}
      <div>
        <div className="mb-2 text-sm font-medium text-gray-700">最近错误 / 日志</div>
        {loading && logs.length === 0 ? (
          <div className="text-sm text-gray-400">加载中…</div>
        ) : logs.length === 0 ? (
          <div className="text-sm text-gray-400">暂无日志</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {logs.map((l) => (
              <li key={l.id} className="flex items-start gap-2 py-2 text-sm">
                <span
                  data-testid={`log-level-${l.id}`}
                  className={`mt-0.5 w-12 shrink-0 text-xs font-semibold uppercase ${logLevelClass(
                    l.level
                  )}`}
                >
                  {l.level || 'info'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-gray-800">{l.message || '—'}</div>
                  <div className="text-xs text-gray-400">
                    {l.module ? `${l.module} · ` : ''}
                    {formatTime(l.created_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ============ 详情视图 ============
function MachineDetailView({
  detail,
  onBack,
  onUpdated,
}: {
  detail: MachineDetail;
  onBack: () => void;
  onUpdated: (m: Machine) => void;
}) {
  const { machine, sessions } = detail;
  const [nickname, setNickname] = useState(machine.nickname || '');
  const [accountLabel, setAccountLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleRename() {
    if (!nickname.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const m = await updateMachine(machine.id, { nickname: nickname.trim() });
      onUpdated(m);
      setNotice('重命名成功');
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRole(role: 'main' | 'sub') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const m = await updateMachine(machine.id, { machine_role: role });
      onUpdated(m);
      setNotice(role === 'main' ? '已设为主机器' : '已设为副机器');
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddAccount() {
    if (!accountLabel.trim() || accountLabel.trim() === 'default') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await dispatchQrBind({
        account_label: accountLabel.trim(),
        agent_id: machine.agent_id,
      });
      setNotice(`已派绑定任务到本机器，请在该机器上弹出登录窗口扫码：${accountLabel.trim()}`);
      setAccountLabel('');
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-blue-600 hover:underline"
      >
        ← 返回机器列表
      </button>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{machine.nickname || machine.hostname}</h2>
        <RoleBadge role={machine.machine_role} />
        <StatusBadge status={machine.status} />
        <span className="font-mono text-xs text-gray-500">{machine.version}</span>
      </div>
      <div className="text-xs text-gray-400">
        主机名 {machine.hostname} · agent_id {machine.agent_id}
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-red-900">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded border border-green-300 bg-green-50 p-3 text-green-800">
          {notice}
        </div>
      ) : null}

      {/* 重命名 + 设主副 */}
      <section className="rounded border p-4">
        <h3 className="mb-3 text-base font-medium">机器设置</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-gray-500">机器显示名（nickname）</label>
            <input
              type="text"
              placeholder="机器显示名（如：主力机）"
              className="w-full rounded border px-3 py-2"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || !nickname.trim()}
            onClick={handleRename}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-300"
          >
            重命名
          </button>
          <button
            type="button"
            disabled={busy || machine.machine_role === 'main'}
            onClick={() => handleSetRole('main')}
            className="rounded border border-blue-600 px-4 py-2 text-blue-600 disabled:opacity-40"
          >
            设为主机器
          </button>
          <button
            type="button"
            disabled={busy || machine.machine_role === 'sub'}
            onClick={() => handleSetRole('sub')}
            className="rounded border border-gray-500 px-4 py-2 text-gray-600 disabled:opacity-40"
          >
            设为副机器
          </button>
        </div>
      </section>

      {/* 抖音号列表 */}
      <section className="rounded border p-4">
        <h3 className="mb-3 text-base font-medium">该机器抖音号（{sessions.length}）</h3>
        {sessions.length === 0 ? (
          <div className="text-gray-500">暂无抖音号 — 用下面表单添加一个</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-600">
                <th className="py-2">号名</th>
                <th className="py-2">昵称</th>
                <th className="py-2">角色</th>
                <th className="py-2">状态</th>
                <th className="py-2">绑定时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.account_label} className="border-b">
                  <td className="py-2">{s.account_label}</td>
                  <td className="py-2">{s.account_nickname || '-'}</td>
                  <td className="py-2">{s.role}</td>
                  <td className="py-2">{s.status}</td>
                  <td className="py-2">{formatTime(s.bound_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 添加抖音号（复用 qr-bind 派单逻辑） */}
      <section className="rounded border p-4">
        <h3 className="mb-3 text-base font-medium">添加抖音号</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-gray-500">
              account_label（小号名，如：装修小号1）
            </label>
            <input
              type="text"
              placeholder="account_label（小号名）"
              className="w-full rounded border px-3 py-2"
              value={accountLabel}
              onChange={(e) => setAccountLabel(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || !accountLabel.trim() || accountLabel.trim() === 'default'}
            onClick={handleAddAccount}
            className="rounded bg-green-600 px-4 py-2 text-white disabled:bg-gray-300"
          >
            添加抖音号（弹出登录扫码）
          </button>
        </div>
      </section>

      {/* 模块与日志（观测事件：升级进度 + 错误日志） */}
      <MachineEventsSection machineId={machine.id} />
    </div>
  );
}

// ============ 页面容器 ============
export default function MachineManagementPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MachineDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMachines();
      setMachines(data);
      setError(null);
    } catch {
      setError('加载机器列表失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await fetchMachineDetail(id);
      setDetail(d);
    } catch {
      setDetailError('加载机器详情失败，请稍后重试');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function backToList() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }

  // 详情里 PUT 成功后：同步详情对象 + 列表里那一行
  function applyUpdated(m: Machine) {
    setDetail((prev) => (prev ? { ...prev, machine: m } : prev));
    setMachines((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">机器管理</h1>
        {!selectedId ? (
          <button
            onClick={loadList}
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
          >
            刷新
          </button>
        ) : null}
      </div>

      {!selectedId ? (
        <>
          {error ? (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div className="px-4 py-10 text-center text-gray-400">加载中…</div>
          ) : (
            <MachineList machines={machines} onSelect={openDetail} />
          )}
        </>
      ) : (
        <>
          {detailLoading ? (
            <div className="px-4 py-10 text-center text-gray-400">加载中…</div>
          ) : detailError ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={backToList}
                className="text-sm text-blue-600 hover:underline"
              >
                ← 返回机器列表
              </button>
              <div className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                {detailError}
              </div>
            </div>
          ) : detail ? (
            <MachineDetailView detail={detail} onBack={backToList} onUpdated={applyUpdated} />
          ) : null}
        </>
      )}
    </div>
  );
}
