/**
 * 智能获客「分析+指派」配置页 — /dashboard/acquisition-config（Line02 获客板块下）
 *
 * 三块：
 *   1. 配置表单（采集 / 触达 / 养号 / Cookie 四组）— 编辑 acquisition_config 全部参数，保存调 PUT。
 *   2. 指派计划块 — GET /dispatch/plan 表格（客户 nickname+score × 小号 × 排期 × 状态）；
 *      「跑分析指派」→ POST build，「执行到期」→ POST run，跑完刷新。
 *   3. Cookie 健康块 — GET cookie-health，各号 healthy 绿 / stale 黄 / expired 红 + expired 显「需重扫」。
 *
 * 契约见 scratchpad/dispatch-engine-contract.md（架构 A：薄指挥放中台，thin 第一刀手动触发）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchAcquisitionConfig,
  updateAcquisitionConfig,
  buildDispatch,
  runDispatch,
  fetchDispatchPlan,
  fetchCookieHealth,
  type AcquisitionConfig,
  type AcquisitionConfigPatch,
  type DispatchPlanItem,
  type CookieHealthItem,
  type CookieHealthResult,
} from '../api/acquisition-dispatch.api';
import { getLine02AccountStatus, type Line02Account } from '../api/line02.api';

// ============ 配置字段元数据（驱动表单分组渲染 + 校验） ============

type FieldKind = 'int' | 'time';
interface FieldMeta {
  key: keyof AcquisitionConfigPatch;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
}
interface FieldGroup {
  title: string;
  fields: FieldMeta[];
}

const GROUPS: FieldGroup[] = [
  {
    title: '采集',
    fields: [
      { key: 'collect_rounds_per_day', label: '每天采集轮数', kind: 'int', min: 1, max: 24 },
      { key: 'keywords_per_round_min', label: '每轮关键词下限', kind: 'int', min: 1, max: 50 },
      { key: 'keywords_per_round_max', label: '每轮关键词上限', kind: 'int', min: 1, max: 50 },
      { key: 'collect_active_start', label: '采集活跃开始', kind: 'time' },
      { key: 'collect_active_end', label: '采集活跃结束', kind: 'time' },
    ],
  },
  {
    title: '触达',
    fields: [
      { key: 'burner_count', label: '触达小号数', kind: 'int', min: 1, max: 20 },
      { key: 'dm_per_hour', label: '每小时每号私信上限', kind: 'int', min: 1, max: 60 },
      { key: 'dm_per_day', label: '每天每号私信上限', kind: 'int', min: 1, max: 500 },
      { key: 'dm_interval_min_sec', label: '私信最小间隔(秒)', kind: 'int', min: 1, max: 86400 },
      { key: 'dm_interval_max_sec', label: '私信最大间隔(秒)', kind: 'int', min: 1, max: 86400 },
      { key: 'dm_active_start', label: '触达活跃开始', kind: 'time' },
      { key: 'dm_active_end', label: '触达活跃结束', kind: 'time' },
    ],
  },
  {
    title: '养号',
    fields: [
      { key: 'nurture_per_day_min', label: '每天养号下限', kind: 'int', min: 0, max: 50 },
      { key: 'nurture_per_day_max', label: '每天养号上限', kind: 'int', min: 0, max: 50 },
    ],
  },
  {
    title: 'Cookie',
    fields: [
      { key: 'cookie_check_interval_hours', label: 'Cookie 检查间隔(小时)', kind: 'int', min: 1, max: 168 },
    ],
  },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(form: AcquisitionConfigPatch): string | null {
  for (const group of GROUPS) {
    for (const f of group.fields) {
      const v = form[f.key];
      if (f.kind === 'int') {
        const n = Number(v);
        if (!Number.isInteger(n)) return `${f.label} 必须是整数`;
        if (f.min != null && n < f.min) return `${f.label} 不能小于 ${f.min}`;
        if (f.max != null && n > f.max) return `${f.label} 不能大于 ${f.max}`;
      } else {
        if (!TIME_RE.test(String(v))) return `${f.label} 时间格式应为 HH:MM`;
      }
    }
  }
  if (form.keywords_per_round_min > form.keywords_per_round_max)
    return '每轮关键词下限不能大于上限';
  if (form.dm_interval_min_sec > form.dm_interval_max_sec)
    return '私信最小间隔不能大于最大间隔';
  if (form.nurture_per_day_min > form.nurture_per_day_max)
    return '每天养号下限不能大于上限';
  return null;
}

function toPatch(c: AcquisitionConfig): AcquisitionConfigPatch {
  // 显式抽取可写字段，去掉 tenant_id / created_at / updated_at
  const {
    collect_rounds_per_day,
    keywords_per_round_min,
    keywords_per_round_max,
    collect_active_start,
    collect_active_end,
    burner_count,
    dm_per_hour,
    dm_per_day,
    dm_interval_min_sec,
    dm_interval_max_sec,
    dm_active_start,
    dm_active_end,
    nurture_per_day_min,
    nurture_per_day_max,
    cookie_check_interval_hours,
  } = c;
  return {
    collect_rounds_per_day,
    keywords_per_round_min,
    keywords_per_round_max,
    collect_active_start,
    collect_active_end,
    burner_count,
    dm_per_hour,
    dm_per_day,
    dm_interval_min_sec,
    dm_interval_max_sec,
    dm_active_start,
    dm_active_end,
    nurture_per_day_min,
    nurture_per_day_max,
    cookie_check_interval_hours,
  };
}

// ============ 配置表单块 ============
function ConfigForm() {
  const [form, setForm] = useState<AcquisitionConfigPatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAcquisitionConfig()
      .then((c) => {
        if (alive) setForm(toPatch(c));
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : '加载配置失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setField = (key: keyof AcquisitionConfigPatch, kind: FieldKind, raw: string) => {
    setForm((prev) =>
      prev ? { ...prev, [key]: kind === 'int' ? (raw === '' ? 0 : Number(raw)) : raw } : prev
    );
    setOk(null);
  };

  const onSave = async () => {
    if (!form) return;
    const v = validate(form);
    if (v) {
      setErr(v);
      setOk(null);
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const saved = await updateAcquisitionConfig(form);
      setForm(toPatch(saved));
      setOk('已保存');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">加载配置中…</p>;
  if (!form) return <p className="text-sm text-red-500">{err || '配置不可用'}</p>;

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="font-medium text-gray-900 dark:text-white mb-4">获客参数配置</h3>
      {GROUPS.map((group) => (
        <div key={group.title} className="mb-5">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{group.title}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.fields.map((f) => (
              <label key={String(f.key)} className="flex flex-col text-sm">
                <span className="text-gray-600 dark:text-gray-400 mb-1">{f.label}</span>
                <input
                  aria-label={`${f.label} ${String(f.key)}`}
                  type={f.kind === 'int' ? 'number' : 'text'}
                  value={String(form[f.key])}
                  onChange={(e) => setField(f.key, f.kind, e.target.value)}
                  className="rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-700 px-2 py-1"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 text-sm"
        >
          {saving ? '保存中…' : '保存配置'}
        </button>
        {ok && <span className="text-sm text-green-600">{ok}</span>}
        {err && <span className="text-sm text-red-500">{err}</span>}
      </div>
    </section>
  );
}

// ============ 指派计划块 ============
const STATUS_LABEL: Record<DispatchPlanItem['status'], string> = {
  queued: '排队',
  dispatched: '已派发',
  sent: '已发送',
  limited: '限流',
  failed: '失败',
};

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleString('zh-CN', { hour12: false });
}

function DispatchPlanBlock() {
  const [plan, setPlan] = useState<DispatchPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await fetchDispatchPlan());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载指派计划失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onBuild = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await buildDispatch();
      setMsg(`已指派：评分 ${r.scored} 条，新增指派 ${r.assigned} 条`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '跑分析指派失败');
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await runDispatch();
      setMsg(`已执行到期：派发 ${r.dispatched} 条`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '执行到期失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-medium text-gray-900 dark:text-white">指派计划</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBuild}
            disabled={busy}
            className="rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 text-sm"
          >
            跑分析指派
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 text-sm"
          >
            执行到期
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-green-600 mb-2">{msg}</p>}
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      {loading ? (
        <p className="text-sm text-gray-500">加载指派计划中…</p>
      ) : plan.length === 0 ? (
        <p className="text-sm text-gray-500">暂无指派计划。点「跑分析指派」从已抓 Leads 生成指派。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-4">客户</th>
                <th className="py-2 pr-4">相关度</th>
                <th className="py-2 pr-4">小号</th>
                <th className="py-2 pr-4">排期时间</th>
                <th className="py-2 pr-4">状态</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="py-2 pr-4 text-gray-900 dark:text-white">
                    {p.nickname || p.lead_id}
                  </td>
                  <td className="py-2 pr-4">{p.relevance_score == null ? '—' : p.relevance_score}</td>
                  <td className="py-2 pr-4">{p.account_label}</td>
                  <td className="py-2 pr-4">{formatTime(p.scheduled_for)}</td>
                  <td className="py-2 pr-4">{STATUS_LABEL[p.status] ?? p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ============ Cookie 健康块 ============
const HEALTH_META: Record<
  CookieHealthItem['health'],
  { label: string; cls: string }
> = {
  healthy: { label: '健康', cls: 'bg-green-100 text-green-700' },
  stale: { label: '陈旧', cls: 'bg-yellow-100 text-yellow-700' },
  expired: { label: '过期', cls: 'bg-red-100 text-red-700' },
};

function CookieHealthBlock() {
  const [data, setData] = useState<CookieHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCookieHealth()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : '加载 Cookie 健康失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-gray-900 dark:text-white">Cookie 健康</h3>
        {data && data.alert_count > 0 && (
          <span className="text-sm text-red-500">{data.alert_count} 个号需重扫</span>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">加载 Cookie 健康中…</p>
      ) : err ? (
        <p className="text-sm text-red-500">{err}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-gray-500">暂无已绑定的号。先到「绑抖音小号」绑定。</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((it) => {
            const m = HEALTH_META[it.health] ?? { label: it.health, cls: 'bg-gray-100 text-gray-600' };
            return (
              <li
                key={it.account_label}
                className="flex items-center justify-between text-sm border border-slate-100 dark:border-slate-700/50 rounded px-3 py-2"
              >
                <span className="text-gray-900 dark:text-white">
                  {it.account_label}
                  <span className="text-gray-400 ml-2">{it.role}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${m.cls}`}>
                    {m.label}
                  </span>
                  {it.needs_rescan && <span className="text-xs text-red-500">需重扫</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============ 主号状态块 ============
function AccountStatusBlock() {
  const [accounts, setAccounts] = useState<Line02Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getLine02AccountStatus()
      .then(data => { if (alive) setAccounts(data.accounts); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const healthLabel = (h: string) => h === 'ok' ? '已登录' : h === 'expired' ? '已过期' : '未知';
  const healthCls = (h: string) => h === 'ok' ? 'text-green-600' : 'text-red-500';

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="font-medium text-gray-900 dark:text-white mb-4">主号状态</h3>
      {loading ? (
        <p className="text-sm text-gray-400">加载中…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-gray-400">暂无绑定账号</p>
      ) : (
        <ul className="space-y-2">
          {accounts.map(a => (
            <li key={a.label} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-gray-800 dark:text-gray-200">{a.label}</span>
              <span className="text-gray-400">{a.role === 'main' ? '主号' : '小号'}</span>
              <span className={healthCls(a.health)}>{healthLabel(a.health)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============ 页面 ============
export default function AcquisitionConfigPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">智能获客 · 分析+指派</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          中台大脑：调采集/触达/养号/Cookie 参数，跑分析把 Leads 指派给小号并排期，盯各号 Cookie 健康。
        </p>
      </div>
      <AccountStatusBlock />
      <ConfigForm />
      <DispatchPlanBlock />
      <CookieHealthBlock />
    </div>
  );
}
