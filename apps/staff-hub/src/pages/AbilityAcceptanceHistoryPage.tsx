import { useState, useEffect } from 'react';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type Run = {
  run_id: string;
  status: string;
  app_id: string;
  line_id: string;
  surface: string;
  created_at: string;
  created_by: string;
};

type RunDetail = {
  run_id: string;
  status: string;
  devices: Array<{
    device_index: number;
    checks: Array<{
      template_id: string;
      result: string;
      checked_by: string;
    }>;
  }>;
};

export default function AbilityAcceptanceHistoryPage() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch('/api/staff/ability-acceptance/runs', user)
      .then(r => r.json())
      .then(data => {
        if (data.success) setRuns(data.data);
        setLoading(false);
      })
      .catch(() => {
        setError('历史记录加载失败');
        setLoading(false);
      });
  }, [user]);

  const handleExpandRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setRunDetail(null);
      return;
    }

    setExpandedRunId(runId);
    try {
      const res = await adminFetch(`/api/staff/ability-acceptance/runs/${runId}`, user);
      const data = await res.json();
      if (data.success) {
        setRunDetail(data.data);
      }
    } catch {
      setError('详情加载失败');
    }
  };

  if (loading) return <div className="page-wrap"><p>加载中...</p></div>;

  return (
    <div className="page-wrap">
      <h1>验收历史</h1>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

      {runs.length === 0 ? (
        <p>暂无历史记录</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #eee' }}>Run ID</th>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #eee' }}>状态</th>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #eee' }}>创建时间</th>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #eee' }}>创建人</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <>
                <tr
                  key={run.run_id}
                  data-run-id={run.run_id}
                  style={{ cursor: 'pointer', background: expandedRunId === run.run_id ? '#f0f7ff' : 'white' }}
                  onClick={() => handleExpandRun(run.run_id)}
                >
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {run.run_id.slice(0, 8)}...
                  </td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                    <span style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: 4,
                      background: run.status === 'submitted' ? '#d4edda' : '#fff3cd',
                      color: run.status === 'submitted' ? '#155724' : '#856404',
                      fontSize: '0.8rem',
                    }}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee', fontSize: '0.85rem' }}>
                    {new Date(run.created_at).toLocaleString('zh-CN')}
                  </td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee', fontSize: '0.85rem' }}>
                    {run.created_by}
                  </td>
                </tr>
                {expandedRunId === run.run_id && runDetail && (
                  <tr key={`${run.run_id}-detail`}>
                    <td colSpan={4}>
                      <div data-testid="run-detail" style={{ padding: '1rem', background: '#f8f9fa', borderRadius: 4 }}>
                        <h3 style={{ margin: '0 0 0.75rem' }}>验收详情</h3>
                        {runDetail.devices.length === 0 ? (
                          <p style={{ color: '#888' }}>无设备结果</p>
                        ) : (
                          runDetail.devices.map(device => (
                            <div key={device.device_index} style={{ marginBottom: '0.75rem' }}>
                              <strong>设备 {device.device_index}</strong>
                              <ul style={{ marginTop: '0.25rem' }}>
                                {device.checks.map(check => (
                                  <li key={check.template_id}>
                                    {check.template_id}: <strong>{check.result}</strong> (by {check.checked_by})
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
