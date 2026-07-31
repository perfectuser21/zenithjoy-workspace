import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Check = { result: string | null };
type Run = { run_key: string; title: string; status: string; gp_id?: string | null; checks: Check[] };

export default function AcceptancePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await adminFetch('/api/staff/acceptance/pending', user);
        const json = await res.json();
        setRuns(json.runs ?? []);
        setDegraded(json.availability === 'degraded');
      } catch {
        setDegraded(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pendingCount = runs.reduce(
    (sum, r) => sum + r.checks.filter((c) => c.result === null).length,
    0
  );

  return (
    <div data-testid="acceptance-page">
      <h1>验收（{pendingCount} 条待处理）</h1>
      {degraded && (
        <div className="pill fail" data-testid="acceptance-degraded-banner">
          验收系统暂时无法连接，请稍后重试
        </div>
      )}
      {loading && <p>加载中...</p>}
      {!loading && !degraded && runs.length === 0 && <p data-testid="acceptance-empty">暂无待验收单</p>}
      <ul>
        {runs.map((run) => {
          const total = run.checks.length;
          const done = run.checks.filter((c) => c.result !== null).length;
          return (
            <li
              key={run.run_key}
              data-testid={`acceptance-run-${run.run_key}`}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/acceptance/${run.run_key}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') navigate(`/acceptance/${run.run_key}`);
              }}
              style={{ cursor: 'pointer' }}
            >
              <strong>{run.title}</strong> — {run.status}（{done}/{total}）
            </li>
          );
        })}
      </ul>
    </div>
  );
}
