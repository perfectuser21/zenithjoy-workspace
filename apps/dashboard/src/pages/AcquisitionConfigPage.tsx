/**
 * 智能获客「参数配置」页 — /dashboard/acquisition-config（Line02 获客板块·设置）
 *
 * 只含获客参数配置表单（采集 / 触达 / 养号 / Cookie 四组）+ 保存按钮。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCompanyProfile, type CompanyProfile } from '../api/company-profile.api';
import { buildRecommendedKeywords } from '../utils/keywords';
import {
  fetchAcquisitionConfig,
  updateAcquisitionConfig,
  type AcquisitionConfig,
  type AcquisitionConfigPatch,
} from '../api/acquisition-dispatch.api';

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

// ============ 推荐关键词 + 开场白话术块 ============
function KeywordsAndOpeningBlock() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [opening, setOpening] = useState('');

  useEffect(() => {
    getCompanyProfile().then(p => {
      setProfile(p);
    }).catch(() => {});
  }, []);

  const chips = profile ? buildRecommendedKeywords(profile) : [];
  const openingPlaceholder = profile?.company_name
    ? `例：您好，我是${profile.company_name}，专注${profile.industry || '行业'}服务，欢迎了解...`
    : '加载公司信息后自动生成开场白建议...';

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="font-medium text-gray-900 dark:text-white mb-4">推荐关键词 &amp; 开场白话术</h3>
      {chips.length > 0 && (
        <div className="mb-4">
          <span className="text-sm text-gray-500 dark:text-gray-400 block mb-2">推荐关键词（基于公司画像）</span>
          <div className="flex flex-wrap gap-2">
            {chips.map(kw => (
              <span key={kw} className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">开场白话术</span>
        <textarea
          value={opening}
          onChange={e => setOpening(e.target.value)}
          placeholder={openingPlaceholder}
          rows={3}
          className="w-full rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-700 px-3 py-2 text-sm"
        />
      </label>
    </section>
  );
}

// ============ 采集任务块 ============

interface CollectTask {
  id: string;
  keywords: string[];
  status: string;
  created_at: string;
  video_count: number;
  lead_count_raw: number;
}

const COLLECT_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  running: '采集中',
  done: '完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  cancelling: '取消中',
};

function CollectTasksBlock() {
  const [tasks, setTasks] = useState<CollectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/acquisition/collect-tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { success: boolean; data?: { tasks: CollectTask[] }; tasks?: CollectTask[] };
      const list = json.data?.tasks ?? (json as unknown as { tasks: CollectTask[] }).tasks ?? [];
      setTasks(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载采集任务失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onStart = async () => {
    const kw = keyword.trim();
    if (!kw) {
      setErr('请输入关键词');
      inputRef.current?.focus();
      return;
    }
    setStarting(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/acquisition/keyword-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw }),
      });
      const json = (await res.json()) as { task_id?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setMsg(`✓ 已派发给 Agent，正在进视频评论区抓评论者，约 1-2 分钟后到「名单」页刷新查看`);
      setKeyword('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提交失败');
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="font-medium text-gray-900 dark:text-white mb-4">关键词采集任务</h3>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          ref={inputRef}
          type="text"
          placeholder="输入关键词，例如：装修公司"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void onStart(); }}
          className="flex-1 min-w-[200px] rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void onStart()}
          disabled={starting}
          className="rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 text-sm whitespace-nowrap"
        >
          {starting ? '提交中…' : '开始采集'}
        </button>
      </div>

      {msg && <p className="text-sm text-green-600 mb-3">{msg}</p>}
      {err && <p className="text-sm text-red-500 mb-3">{err}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">加载采集任务中…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-500">暂无采集任务。输入关键词点「开始采集」发起第一个任务。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-4">关键词</th>
                <th className="py-2 pr-4">状态</th>
                <th className="py-2 pr-4">创建时间</th>
                <th className="py-2 pr-4">视频数</th>
                <th className="py-2 pr-4">Lead 数</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="py-2 pr-4 text-gray-900 dark:text-white max-w-[200px] truncate">
                    {Array.isArray(t.keywords) ? t.keywords.join('、') : String(t.keywords)}
                  </td>
                  <td className="py-2 pr-4">{COLLECT_STATUS_LABEL[t.status] ?? t.status}</td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {t.created_at ? new Date(t.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
                  </td>
                  <td className="py-2 pr-4">{t.video_count ?? 0}</td>
                  <td className="py-2 pr-4">{t.lead_count_raw ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ============ 页面 ============
export default function AcquisitionConfigPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">设置</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          调整采集/触达/养号/Cookie 参数，管理采集关键词任务。
        </p>
      </div>
      <KeywordsAndOpeningBlock />
      <CollectTasksBlock />
      <ConfigForm />
    </div>
  );
}
