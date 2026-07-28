import { useState, useEffect } from 'react';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type VersionInfo = {
  version: string;
  source: string;
};

type VersionData = {
  staging: VersionInfo;
  production: VersionInfo;
};

type Template = {
  id: string;
  kind: string;
  seq: number;
  title: string;
  description?: string;
};

type CheckResult = {
  template_id: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'pending';
};

type PagePhase = 'overview' | 'running' | 'submitted';

export default function AbilityAcceptancePage() {
  const { user } = useAuth();
  const [versions, setVersions] = useState<VersionData | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [phase, setPhase] = useState<PagePhase>('overview');
  const [runId, setRunId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckResult['result']>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    adminFetch('/api/staff/ability-acceptance/versions', user)
      .then(r => r.json())
      .then(data => {
        if (data.success) setVersions(data.data);
      })
      .catch(() => setError('版本信息加载失败'));
  }, [user]);

  const handleCreateRun = async () => {
    try {
      setError(null);
      // 获取模板
      const tplRes = await adminFetch('/api/staff/ability-acceptance/templates', user);
      const tplData = await tplRes.json();
      if (tplData.success) {
        setTemplates(tplData.data);
      }

      // 创建 run
      const runRes = await adminFetch('/api/staff/ability-acceptance/runs', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: 'customer_app',
          line_id: 'line00',
          surface: 'web',
          task_id: 'manual',
          sha: Date.now().toString(),
        }),
      });
      const runData = await runRes.json();
      if (runData.success) {
        setRunId(runData.data.run_id);
        setPhase('running');
      }
    } catch {
      setError('创建验收 run 失败');
    }
  };

  const handleCheckChange = (templateId: string, result: CheckResult['result']) => {
    setChecks(prev => ({ ...prev, [templateId]: result }));
  };

  const handleSubmit = async () => {
    if (!runId) return;
    setSubmitting(true);
    setError(null);

    try {
      // 提交每个检查结果
      for (const [templateId, result] of Object.entries(checks)) {
        await adminFetch(`/api/staff/ability-acceptance/runs/${runId}/devices/1/checks`, user, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: templateId, result }),
        });
      }

      // 提交 run
      const submitRes = await adminFetch(`/api/staff/ability-acceptance/runs/${runId}/submit`, user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const submitData = await submitRes.json();
      if (submitData.success) {
        setPhase('submitted');
      }
    } catch {
      setError('提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-wrap">
      <h1>Ability 验收</h1>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

      {/* 版本概览 */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ flex: 1 }}>
          <div style={{ fontSize: '0.8rem', color: '#888' }}>Staging 版本</div>
          <div data-testid="version-staging" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
            {versions?.staging?.version ?? '加载中...'}
          </div>
          {versions?.staging?.source && (
            <div style={{ fontSize: '0.75rem', color: '#aaa' }}>{versions.staging.source}</div>
          )}
        </div>
        <div className="card" style={{ flex: 1 }}>
          <div style={{ fontSize: '0.8rem', color: '#888' }}>Production 版本</div>
          <div data-testid="version-production" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
            {versions?.production?.version ?? '加载中...'}
          </div>
          {versions?.production?.source && (
            <div style={{ fontSize: '0.75rem', color: '#aaa' }}>{versions.production.source}</div>
          )}
        </div>
      </div>

      {/* 状态展示 */}
      {phase === 'submitted' && (
        <div style={{ padding: '1rem', background: '#d4edda', borderRadius: 8, marginBottom: '1rem', fontWeight: 'bold', color: '#155724' }}>
          验收已提交
        </div>
      )}

      {phase === 'overview' && (
        <button className="button" onClick={handleCreateRun}>
          新建验收 run
        </button>
      )}

      {phase === 'running' && (
        <div>
          <div data-testid="acceptance-checklist">
            <h2>验收项清单</h2>
            {templates.length === 0 ? (
              <p>暂无验收模板</p>
            ) : (
              templates.map(tpl => (
                <div key={tpl.id} style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f8f9fa', borderRadius: 6 }}>
                  <div><strong>[{tpl.kind}] {tpl.title}</strong></div>
                  {tpl.description && <div style={{ fontSize: '0.85rem', color: '#666' }}>{tpl.description}</div>}
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                    {(['PASS', 'FAIL', 'BLOCKED'] as const).map(r => (
                      <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`check-${tpl.id}`}
                          value={r}
                          data-testid={`check-pass-${tpl.id}`}
                          checked={checks[tpl.id] === r}
                          onChange={() => handleCheckChange(tpl.id, r)}
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <button
            className="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{ marginTop: '1rem' }}
          >
            {submitting ? '提交中...' : '提交验收'}
          </button>
        </div>
      )}
    </div>
  );
}
