import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

export type LineEnvironment = {
  name: 'dev' | 'staging' | 'production';
  status: 'active' | 'stale' | 'not_deployed' | 'unavailable';
  commit_sha: string | null;
  commit_date: string | null;
};

export type LinePendingChange = {
  sha: string;
  message: string;
  url: string;
  date: string | null;
};

export type LineHealthItem = {
  line_key: string;
  label: string;
  journey_id: string | null;
  journey_name: string | null;
  maturity: string;
  availability: 'ready' | 'degraded' | 'not_connected';
  message: string | null;
  feature_counts: {
    total: number;
    done: number;
    working: number;
    planned: number;
  };
  environments: LineEnvironment[];
  pending_changes: LinePendingChange[];
};

function renderAvailabilityPill(item: LineHealthItem) {
  // 判定点 1：未接入是一种独立状态，不是"0 进度"，也不是错误
  if (item.availability === 'not_connected') {
    return (
      <span className="pill warn" data-testid={`line-badge-${item.line_key}`}>
        未接入
      </span>
    );
  }
  if (item.availability === 'degraded') {
    return (
      <span className="pill fail" data-testid={`line-badge-${item.line_key}`}>
        数据暂不可达
      </span>
    );
  }
  return (
    <span className="pill" data-testid={`line-badge-${item.line_key}`}>
      正常
    </span>
  );
}

const ENV_LABEL: Record<LineEnvironment['name'], string> = {
  dev: 'dev',
  staging: 'staging',
  production: 'prod',
};

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '(未部署)';
}

function renderVersionRow(item: LineHealthItem) {
  if (item.environments.length === 0) return null;
  const byName = Object.fromEntries(item.environments.map((e) => [e.name, e]));
  return (
    <p className="muted" data-testid={`line-versions-${item.line_key}`}>
      {(['dev', 'staging', 'production'] as const)
        .map((name) => `${ENV_LABEL[name]} ${shortSha(byName[name]?.commit_sha ?? null)}`)
        .join(' · ')}
    </p>
  );
}

function renderPendingChanges(item: LineHealthItem) {
  if (item.pending_changes.length === 0) return null;
  return (
    <div className="muted" style={{ marginTop: 6 }} data-testid={`line-pending-changes-${item.line_key}`}>
      staging 比 production 多 {item.pending_changes.length} 个提交：
      <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
        {item.pending_changes.slice(0, 5).map((change) => (
          <li key={change.sha}>
            <a href={change.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
              {change.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LineHealthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<LineHealthItem[]>([]);
  const [source, setSource] = useState<string>('product_map');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/staff/line-health', user);
      if (!res.ok) {
        setError(`加载失败（${res.status}）`);
        setLoading(false);
        return;
      }
      const json = await res.json();
      setItems(json.data ?? []);
      setSource(json.source ?? 'product_map');
      setFallbackReason(json.fallback_reason ?? null);
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
    <div className="list" data-testid="line-health-page">
      <div className="card">
        <div className="section-title">
          <div>
            <h2>业务线健康</h2>
            <p className="muted">
              对外三条业务线（line01 / line02 / line04）的接入状态、能力完成度、三环境版本与待发布变更。
            </p>
          </div>
          <button className="button secondary" onClick={() => void load()}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>

        {source === 'fallback' ? (
          <div className="error" data-testid="fallback-banner">
            业务线清单降级：product-map.json 不可用，当前展示的是内置兜底清单。{fallbackReason}
          </div>
        ) : null}

        {loading ? <p>加载中...</p> : null}
        {error ? <div className="error">{error}</div> : null}

        <div className="path-grid">
          {items.map((item) => (
            <article
              key={item.line_key}
              className="list-row"
              data-testid={`line-card-${item.line_key}`}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/line-health/${item.line_key}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') navigate(`/line-health/${item.line_key}`);
              }}
            >
              <div className="section-title">
                <div>
                  <h3>{item.label}</h3>
                  <p className="muted">{item.journey_name ?? '尚未接入 Brain journey'}</p>
                </div>
                {renderAvailabilityPill(item)}
              </div>
              <p className="muted">
                maturity: <strong>{item.maturity}</strong> · done {item.feature_counts.done}/
                {item.feature_counts.total}
              </p>
              {renderVersionRow(item)}
              {renderPendingChanges(item)}
              {item.availability === 'degraded' && item.message ? (
                <div className="error" style={{ marginTop: 10 }}>
                  数据暂不可达：{item.message}
                </div>
              ) : null}
              {item.availability === 'not_connected' ? (
                <p className="muted" data-testid={`line-not-connected-${item.line_key}`}>
                  该业务线尚未接入 Brain 数据，暂无法展示完成度。
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
