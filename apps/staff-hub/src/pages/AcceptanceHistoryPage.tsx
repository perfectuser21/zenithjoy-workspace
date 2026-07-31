import { useState } from 'react';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Check = { check_key: string; name: string; result: string | null; note: string | null };
type Run = { run_key: string; title: string; version: string | null; created_at: string; checks: Check[] };

export default function AcceptanceHistoryPage() {
  const { user } = useAuth();
  const [gpId, setGpId] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!gpId) return;
    try {
      const res = await adminFetch(`/api/staff/acceptance/history?gp_id=${encodeURIComponent(gpId)}`, user);
      const json = await res.json();
      setDegraded(json.availability === 'degraded');
      setRuns(json.runs ?? []);
    } catch {
      setDegraded(true);
      setRuns([]);
    } finally {
      setSearched(true);
    }
  };

  return (
    <div data-testid="acceptance-history-page">
      <h1>验收历史</h1>
      <input
        data-testid="acceptance-history-gpid-input"
        placeholder="输入 GP ID"
        value={gpId}
        onChange={(e) => setGpId(e.target.value)}
      />
      <button data-testid="acceptance-history-search" onClick={() => void search()}>查询</button>

      {degraded && <p data-testid="acceptance-degraded-banner">验收系统暂时无法连接，请稍后重试</p>}
      {!degraded && searched && runs.length === 0 && <p data-testid="acceptance-history-empty">暂无历史记录</p>}

      <ul>
        {runs.map((run) => (
          <li key={run.run_key}>
            <div
              data-testid={`acceptance-history-run-${run.run_key}`}
              role="button"
              tabIndex={0}
              onClick={() => setExpanded(expanded === run.run_key ? null : run.run_key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  setExpanded(expanded === run.run_key ? null : run.run_key);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              {run.title}（{run.version ?? '未知版本'}） — {run.created_at}
            </div>
            {expanded === run.run_key && (
              <ul>
                {run.checks.map((c) => (
                  <li key={c.check_key}>
                    {c.name}: {c.result ?? '未填写'} {c.note && <>（<span>{c.note}</span>）</>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
