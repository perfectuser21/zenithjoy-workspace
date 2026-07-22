import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type PathHealthItem = {
  path_key: string;
  label: string;
  journey_id: string;
  journey_name: string;
  maturity: string;
  availability: 'ready' | 'degraded';
  message: string | null;
  feature_counts: {
    total: number;
    done: number;
    working: number;
    planned: number;
  };
  features: Array<{
    id: string;
    name: string;
    status: string;
    thickness: string;
    kind: string;
    updated_at: string | null;
  }>;
  smoke: null | {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    started_at: string | null;
    updated_at: string | null;
  };
};

function renderSmokePill(item: PathHealthItem) {
  if (!item.smoke) return <span className="pill warn">暂无 smoke 结果</span>;
  if (item.smoke.conclusion === 'success') return <span className="pill">Smoke 通过</span>;
  if (item.smoke.conclusion === 'failure') return <span className="pill fail">Smoke 失败</span>;
  return <span className="pill warn">Smoke 进行中</span>;
}

export default function PathHealthPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<PathHealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/staff/path-health', user?.email);
      if (!res.ok) {
        setError(`加载失败（${res.status}）`);
        setLoading(false);
        return;
      }
      const json = await res.json();
      setItems(json.data ?? []);
    } catch {
      setError('数据暂不可达');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="list">
      <div className="card">
        <div className="section-title">
          <div>
            <h2>Path 健康</h2>
            <p className="muted">当前基于 Brain 公开 `journey_features` 与 GitHub 最近 smoke run 聚合。</p>
          </div>
          <button className="button secondary" onClick={() => void load()}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>
        {loading ? <p>加载中...</p> : null}
        {error ? <div className="error">{error}</div> : null}
        <div className="path-grid">
          {items.map((item) => (
            <article key={item.path_key} className="list-row">
              <div className="section-title">
                <div>
                  <h3>{item.label}</h3>
                  <p className="muted">{item.journey_name}</p>
                </div>
                {renderSmokePill(item)}
              </div>
              <p className="muted">
                maturity: <strong>{item.maturity}</strong> · done {item.feature_counts.done}/{item.feature_counts.total}
              </p>
              {item.availability === 'degraded' ? (
                <div className="error" style={{ marginTop: 10 }}>
                  数据暂不可达：{item.message}
                </div>
              ) : null}
              <div className="feature-list">
                {item.features.slice(0, 6).map((feature) => (
                  <div key={feature.id} className="feature-item">
                    <strong>{feature.name}</strong>
                    <div className="muted">
                      {feature.kind} · {feature.status} · {feature.thickness}
                    </div>
                  </div>
                ))}
              </div>
              {item.smoke ? (
                <div style={{ marginTop: 14 }}>
                  <a href={item.smoke.html_url} target="_blank" rel="noreferrer">
                    查看最近 smoke run
                  </a>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
