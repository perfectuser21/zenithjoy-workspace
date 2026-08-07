import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Detail = { op?: string[]; exp?: string; pass?: string; fail?: string } | null;
type Check = {
  id: string; check_key: string; kind: 'FR' | 'NFR' | 'Invariant' | 'SOP';
  name: string; device: string | null; result: string | null; note: string | null; detail: Detail;
};
type Run = { run_key: string; title: string; status: string; pass_rate: number | null; checks: Check[] };

const KINDS: Array<Check['kind']> = ['FR', 'NFR', 'Invariant', 'SOP'];

// v1 简化：判定项名字里若含 "Step N" 前缀就按此分组，否则归"未分组"
// （Brain checks 暂无独立 step 字段，见 design 文档"不包含"一节，非本次范围）
export function stepOf(name: string): string {
  const m = name.match(/step\s*(\d+)/i);
  return m ? `Step ${m[1]}` : '未分组';
}

export default function AcceptanceDetailPage() {
  const { runKey } = useParams<{ runKey: string }>();
  const { user } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [draft, setDraft] = useState<Record<string, { result: string; note: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const load = async () => {
    try {
      const res = await adminFetch(`/api/staff/acceptance/pending`, user);
      const json = await res.json();
      if (json.availability === 'degraded') { setDegraded(true); return; }
      const found = (json.runs ?? []).find((r: Run) => r.run_key === runKey) ?? null;
      setRun(found);
    } catch {
      setDegraded(true);
    }
  };

  useEffect(() => { void load(); }, [runKey]);

  const grouped = useMemo(() => {
    if (!run) return {};
    const groups: Record<string, Check[]> = {};
    for (const c of run.checks) {
      const step = stepOf(c.name);
      (groups[step] ??= []).push(c);
    }
    return groups;
  }, [run]);

  const matrix = useMemo(() => {
    if (!run) return {};
    const m: Record<string, Record<string, number>> = {};
    for (const step of Object.keys(grouped)) {
      m[step] = {};
      for (const kind of KINDS) {
        m[step][kind] = grouped[step].filter((c) => c.kind === kind).length;
      }
    }
    return m;
  }, [grouped, run]);

  const handleSubmit = async () => {
    const items = Object.entries(draft)
      .filter(([, v]) => v.result)
      .map(([check_key, v]) => ({ check_key, result: v.result as '通过' | '不通过' | '无法验证', note: v.note || undefined }));
    if (items.length === 0 || !run) return;
    setSubmitState('submitting');
    try {
      const res = await adminFetch('/api/staff/acceptance/results', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_key: run.run_key, results: items }),
      });
      if (!res.ok) throw new Error('submit failed');
      setSubmitState('success');
      setDraft({});
      await load();
    } catch {
      setSubmitState('error');
    }
  };

  if (degraded) return <div data-testid="acceptance-degraded-banner">验收系统暂时无法连接，请稍后重试</div>;
  if (!run) return <p>加载中...</p>;

  return (
    <div data-testid="acceptance-detail-page">
      <Link to="/acceptance">← 返回验收列表</Link>
      <h1>{run.title}</h1>

      <table data-testid="acceptance-matrix">
        <thead>
          <tr><th>Step</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr>
        </thead>
        <tbody>
          {Object.keys(matrix).map((step) => (
            <tr key={step}>
              <td>{step}</td>
              {KINDS.map((k) => <td key={k}>{matrix[step][k] || '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      {Object.entries(grouped).map(([step, checks]) => (
        <section key={step}>
          <h2>{step}</h2>
          {checks.map((c) => (
            <div key={c.check_key} data-testid={`acceptance-check-${c.check_key}`}>
              <span>[{c.kind}] {c.name}</span>
              {c.device && <span> ({c.device})</span>}
              {c.detail && (
                <button
                  data-testid={`acceptance-expand-${c.check_key}`}
                  onClick={() => setExpanded((e) => ({ ...e, [c.check_key]: !e[c.check_key] }))}
                >
                  {expanded[c.check_key] ? '收起' : '展开工作卡'}
                </button>
              )}
              {expanded[c.check_key] && c.detail && (
                <div data-testid={`acceptance-workcard-${c.check_key}`}>
                  {c.detail.op && <p>操作步骤: {c.detail.op.join(' → ')}</p>}
                  {c.detail.exp && <p>预期结果: {c.detail.exp}</p>}
                  {c.detail.pass && <p>通过判定: {c.detail.pass}</p>}
                  {c.detail.fail && <p>不通过判定: {c.detail.fail}</p>}
                </div>
              )}
              <select
                data-testid={`acceptance-result-${c.check_key}`}
                value={draft[c.check_key]?.result ?? c.result ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.check_key]: { result: e.target.value, note: d[c.check_key]?.note ?? c.note ?? '' } }))
                }
              >
                <option value="">未填写</option>
                <option value="通过">通过</option>
                <option value="不通过">不通过</option>
                <option value="无法验证">无法验证</option>
              </select>
              <input
                data-testid={`acceptance-note-${c.check_key}`}
                placeholder="意见"
                value={draft[c.check_key]?.note ?? c.note ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.check_key]: { result: d[c.check_key]?.result ?? c.result ?? '', note: e.target.value } }))
                }
              />
            </div>
          ))}
        </section>
      ))}

      <button data-testid="acceptance-submit" onClick={() => void handleSubmit()} disabled={submitState === 'submitting'}>
        提交
      </button>
      {submitState === 'success' && <p data-testid="acceptance-submit-success">提交成功</p>}
      {submitState === 'error' && <p data-testid="acceptance-submit-error">提交失败，请重试</p>}
    </div>
  );
}
