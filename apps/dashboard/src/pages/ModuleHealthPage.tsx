/**
 * Sprint 06081603 ws-gamma — 客户机器模块健康看板
 *
 * 行 = 已注册客户机器（agent_id + hostname）
 * 列 = Line01 智能发布 / Line02 智能获客 / Line04 微信AI客服 / Line05 视频剪辑
 * 单元格：
 *   - ok:true  -> 绿点 + 在线
 *   - ok:false -> 红点 + reason 文字（hover title + 行内可见）
 *   - 无数据   -> 灰点 + 无数据
 * 每 30s 自动刷新，支持手动刷新；加载中显示 skeleton。
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchModuleHealth, type AgentModuleHealth } from '../api/moduleHealth.api';

// 状态点用 unicode 转义表示，避免源码内出现裸表情符号
const DOT_ONLINE = '\u{1F7E2}'; // 绿色圆点
const DOT_FAIL = '\u{1F534}'; // 红色圆点
const DOT_NONE = '⚪'; // 白色圆点

// 看板列定义：module_status 的 key -> 中文 Line 名
const LINES = [
  { key: 'line01-publish', label: 'Line01 智能发布' },
  { key: 'line02-lead-gen', label: 'Line02 智能获客' },
  { key: 'line04-wechat-cs', label: 'Line04 微信AI客服' },
  { key: 'line05-video', label: 'Line05 视频剪辑' },
] as const;

/**
 * 把 ISO 时间换算成相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）。
 * @param iso  目标时间
 * @param nowMs 当前时间戳（毫秒），默认 Date.now()；测试时可注入固定值
 */
export function formatRelativeTime(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const now = nowMs ?? Date.now();
  const diffSec = Math.floor((now - t) / 1000);
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function StatusCell({ entry }: { entry?: { ok: boolean; reason?: string } }) {
  // 机器未上报该模块 -> 灰点 无数据
  if (!entry) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400 text-xs" title="该机器未上报此模块">
        <span aria-hidden="true">{DOT_NONE}</span>
        <span>无数据</span>
      </span>
    );
  }
  if (entry.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
        <span aria-hidden="true">{DOT_ONLINE}</span>
        <span>在线</span>
      </span>
    );
  }
  // ok:false -> 红点 + reason（title 悬浮 + 行内截断可见）
  const reason = entry.reason || '环境预检未通过';
  return (
    <span
      className="inline-flex items-center gap-1 text-red-500 text-xs font-medium max-w-[220px]"
      title={reason}
    >
      <span aria-hidden="true">{DOT_FAIL}</span>
      <span className="truncate">{reason}</span>
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="animate-pulse">
          <td className="border border-gray-200 px-4 py-3">
            <div className="h-3 w-32 bg-gray-200 rounded" />
          </td>
          {LINES.map((l) => (
            <td key={l.key} className="border border-gray-200 px-4 py-3 text-center">
              <div className="h-3 w-16 bg-gray-100 rounded mx-auto" />
            </td>
          ))}
          <td className="border border-gray-200 px-4 py-3 text-center">
            <div className="h-3 w-16 bg-gray-100 rounded mx-auto" />
          </td>
          <td className="border border-gray-200 px-4 py-3">
            <div className="h-3 w-16 bg-gray-100 rounded" />
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * 从 line04-wechat-cs 的 reason 字符串里解析出「微信版本号」+「静默状态」。
 * reason 由 agent line04 preflight 透出（如 "微信 4.1.8.107 / 静默 SILENT"），
 * 看板单元格只显示 {ok,reason}，绿了看不到这两项 → 本函数把它们抠出来单独成列。
 */
export function parseWechatStatus(reason?: string): {
  version: string | null;
  silent: 'SILENT' | 'NOT_SILENT' | 'SKIP' | null;
} {
  const r = reason || '';
  const vm = r.match(/微信\s+(\d+\.\d+\.\d+(?:\.\d+)?)/);
  const version = vm ? vm[1] : null;
  let silent: 'SILENT' | 'NOT_SILENT' | 'SKIP' | null = null;
  // 必须先判 NOT-SILENT（它含子串 SILENT，否则会被误判成 SILENT）
  if (/静默[\s:：]*NOT[\s-]*SILENT/i.test(r)) silent = 'NOT_SILENT';
  else if (/静默[\s:：]*SILENT/i.test(r)) silent = 'SILENT';
  else if (/静默[\s:：]*跳过/.test(r)) silent = 'SKIP';
  return { version, silent };
}

/** 微信版本 + 静默状态专列单元格：绿红都常显（不像通用 StatusCell 绿了只显"在线"）。 */
function WechatStatusCell({ entry }: { entry?: { ok: boolean; reason?: string } }) {
  if (!entry) {
    return (
      <span className="text-gray-400 text-xs" title="该机器未上报 line04 微信客服模块">
        {DOT_NONE} 无数据
      </span>
    );
  }
  const { version, silent } = parseWechatStatus(entry.reason);
  const silentBadge =
    silent === 'SILENT' ? (
      <span className="text-green-600">{DOT_ONLINE} 静默</span>
    ) : silent === 'NOT_SILENT' ? (
      <span className="text-red-500">{DOT_FAIL} 露头</span>
    ) : silent === 'SKIP' ? (
      <span className="text-gray-400">静默未检</span>
    ) : (
      <span className="text-gray-400">—</span>
    );
  return (
    <span className="inline-flex flex-col gap-0.5 text-xs leading-tight">
      <span className="font-mono text-gray-700">{version || '版本未知'}</span>
      {silentBadge}
    </span>
  );
}

export default function ModuleHealthPage() {
  const [rows, setRows] = useState<AgentModuleHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetchModuleHealth();
      setRows(Array.isArray(res?.data) ? res.data : []);
      setError(null);
    } catch {
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">客户机器模块健康状态</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">每 30 秒自动刷新</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {refreshing ? '刷新中…' : '手动刷新'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
          {error}
        </div>
      )}

      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-4 py-2 text-left font-medium text-gray-600">
                客户机器
              </th>
              {LINES.map((l) => (
                <th
                  key={l.key}
                  className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600"
                >
                  {l.label}
                </th>
              ))}
              <th className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600">
                微信版本 / 静默
              </th>
              <th className="border border-gray-200 px-4 py-2 text-center font-medium text-gray-600">
                最后更新
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={LINES.length + 3}
                  className="border border-gray-200 px-4 py-8 text-center text-gray-400"
                >
                  暂无已注册机器
                </td>
              </tr>
            ) : (
              rows.map((row: AgentModuleHealth) => (
                <tr key={row.agent_id} className="hover:bg-gray-50">
                  <td className="border border-gray-200 px-4 py-3">
                    <div className="font-medium">{row.hostname || '未知主机'}</div>
                    <div className="text-xs text-gray-400">{row.agent_id}</div>
                  </td>
                  {LINES.map((l) => (
                    <td key={l.key} className="border border-gray-200 px-4 py-3 text-center">
                      <StatusCell entry={row.module_status?.[l.key]} />
                    </td>
                  ))}
                  <td className="border border-gray-200 px-4 py-3 text-center">
                    <WechatStatusCell entry={row.module_status?.['line04-wechat-cs']} />
                  </td>
                  <td className="border border-gray-200 px-4 py-3 text-center text-xs text-gray-500">
                    {formatRelativeTime(row.updated_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
