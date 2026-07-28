import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type EnvStatus = 'active' | 'stale' | 'not_deployed' | 'unavailable';

type DeploymentData = {
  line_key: string;
  connected: boolean;
  message: string | null;
  environments: Array<{
    name: string;
    status: EnvStatus;
    commit_sha: string | null;
    commit_date: string | null;
  }>;
  recent_commit: null | { sha: string; message: string; date: string | null; url: string };
  related_prs: Array<{
    number: number;
    title: string;
    url: string;
    state: string;
    updated_at: string | null;
  }>;
};

type AbilitiesData = {
  line_key: string;
  connected: boolean;
  message: string | null;
  abilities: Array<{
    id: string;
    name: string;
    status: string;
    thickness: string;
    kind: string;
    updated_at: string | null;
  }>;
};

const ENV_LABELS: Record<string, string> = {
  dev: '开发（develop）',
  staging: '预发（release/*）',
  production: '生产（main）',
};

const ENV_STATUS_LABELS: Record<EnvStatus, string> = {
  active: '活跃',
  stale: '陈旧（超 30 天无相关提交）',
  not_deployed: '未部署 / 无匹配提交',
  unavailable: 'GitHub 暂不可达',
};

function envPillClass(status: EnvStatus): string {
  if (status === 'active') return 'pill';
  if (status === 'stale') return 'pill warn';
  return 'pill fail';
}

export default function LineHealthDetailPage() {
  const { lineKey = '' } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<'deployment' | 'abilities'>('deployment');
  const [deployment, setDeployment] = useState<DeploymentData | null>(null);
  const [abilities, setAbilities] = useState<AbilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [deployRes, abilityRes] = await Promise.all([
        adminFetch(`/api/staff/line-health/${lineKey}/deployment`, user),
        adminFetch(`/api/staff/line-health/${lineKey}/abilities`, user),
      ]);
      if (deployRes.status === 404 || abilityRes.status === 404) {
        setError(`未知业务线：${lineKey}`);
        setLoading(false);
        return;
      }
      if (!deployRes.ok || !abilityRes.ok) {
        setError(`加载失败（${deployRes.status}/${abilityRes.status}）`);
        setLoading(false);
        return;
      }
      const deployJson = await deployRes.json();
      const abilityJson = await abilityRes.json();
      setDeployment(deployJson.data ?? null);
      setAbilities(abilityJson.data ?? null);
    } catch {
      setError('数据暂不可达');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [lineKey]);

  return (
    <div className="list" data-testid="line-detail-page">
      <div className="card">
        <div className="section-title">
          <div>
            <Link to="/line-health" className="button secondary" data-testid="back-to-overview">
              <ArrowLeft size={16} /> 返回业务线总览
            </Link>
            <h2 style={{ marginTop: 12 }}>{lineKey}</h2>
          </div>
          <button className="button secondary" onClick={() => void load()}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>

        <div className="nav" style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <button
            className={`button${tab === 'deployment' ? '' : ' secondary'}`}
            data-testid="tab-deployment"
            onClick={() => setTab('deployment')}
          >
            部署
          </button>
          <button
            className={`button${tab === 'abilities' ? '' : ' secondary'}`}
            data-testid="tab-abilities"
            onClick={() => setTab('abilities')}
          >
            能力
          </button>
        </div>

        {loading ? <p>加载中...</p> : null}
        {error ? <div className="error">{error}</div> : null}

        {tab === 'deployment' && deployment ? (
          <section data-testid="deployment-panel">
            {!deployment.connected ? (
              <div className="error" data-testid="deployment-not-connected">
                {deployment.message}
              </div>
            ) : (
              <>
                <h3>环境状态</h3>
                <div className="feature-list" data-testid="deployment-environments">
                  {deployment.environments.map((env) => (
                    <div key={env.name} className="feature-item" data-testid={`env-row-${env.name}`}>
                      <strong>{ENV_LABELS[env.name] ?? env.name}</strong>
                      <div className="muted">
                        <span className={envPillClass(env.status)}>{ENV_STATUS_LABELS[env.status]}</span>{' '}
                        {env.commit_sha ? `${env.commit_sha.slice(0, 7)} · ${env.commit_date ?? ''}` : '—'}
                      </div>
                    </div>
                  ))}
                </div>

                <h3 style={{ marginTop: 18 }}>最近相关提交</h3>
                {deployment.recent_commit ? (
                  <p className="muted" data-testid="recent-commit">
                    <a href={deployment.recent_commit.url} target="_blank" rel="noreferrer">
                      {deployment.recent_commit.sha.slice(0, 7)}
                    </a>{' '}
                    · {deployment.recent_commit.message.split('\n')[0]} · {deployment.recent_commit.date ?? ''}
                  </p>
                ) : (
                  <p className="muted" data-testid="recent-commit-empty">
                    暂无按本业务线相关路径过滤到的提交
                  </p>
                )}

                <h3 style={{ marginTop: 18 }}>关联 PR（按标题关键词匹配）</h3>
                {deployment.related_prs.length > 0 ? (
                  <div className="feature-list" data-testid="related-prs">
                    {deployment.related_prs.map((pr) => (
                      <div key={pr.number} className="feature-item">
                        <strong>
                          <a href={pr.url} target="_blank" rel="noreferrer">
                            #{pr.number}
                          </a>{' '}
                          {pr.title}
                        </strong>
                        <div className="muted">
                          {pr.state} · {pr.updated_at ?? ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted" data-testid="related-prs-empty">
                    暂无标题匹配的近期 PR
                  </p>
                )}
              </>
            )}
          </section>
        ) : null}

        {tab === 'abilities' && abilities ? (
          <section data-testid="abilities-panel">
            {!abilities.connected ? (
              <div className="error" data-testid="abilities-not-connected">
                {abilities.message}
              </div>
            ) : abilities.abilities.length > 0 ? (
              <div className="feature-list" data-testid="abilities-list">
                {abilities.abilities.map((ability) => (
                  <div key={ability.id} className="feature-item" data-testid={`ability-row-${ability.id}`}>
                    <strong>{ability.name}</strong>
                    <div className="muted">
                      {ability.kind} · {ability.status} · {ability.thickness}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" data-testid="abilities-empty">
                数据暂不可达：{abilities.message ?? '该业务线当前没有登记的能力条目'}
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
