import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

type CellVerdict = '绿' | '红' | '无法验证' | null;

type Cell = {
  cell_id: string;
  scenario_id: string;
  scenario_class?: string;
  device?: string;
  step?: number;
  na?: boolean;
  ai_verdict?: CellVerdict;
  human_verdict?: CellVerdict;
  ai_evidence?: string;
  human_note?: string;
  adjudicated?: boolean;
  adjudicated_verdict?: CellVerdict;
  is_s13_c4?: boolean;
};

type QuadrantData = {
  run_key: string;
  human_complete: boolean;
  matrix: Cell[];
  availability?: string;
};

type AdjudicateState = 'idle' | 'submitting' | 'success' | 'error';
type AckState = 'idle' | 'submitting' | 'done' | 'error';

function isDivergent(cell: Cell): boolean {
  if (cell.na) return false;
  if (cell.is_s13_c4) return false;
  return cell.ai_verdict !== cell.human_verdict &&
    cell.ai_verdict !== null &&
    cell.human_verdict !== null;
}

function cellColorClass(ai: CellVerdict, human: CellVerdict): string {
  if (!ai || !human) return 'cell-pending';
  const key = `${ai}-${human}`;
  const map: Record<string, string> = {
    '绿-绿': 'cell-green-green',
    '绿-红': 'cell-diverge-ai-green',
    '绿-无法验证': 'cell-diverge-ai-green',
    '红-绿': 'cell-diverge-human-green',
    '红-红': 'cell-red-red',
    '红-无法验证': 'cell-diverge',
    '无法验证-绿': 'cell-diverge',
    '无法验证-红': 'cell-diverge',
    '无法验证-无法验证': 'cell-ni-ni',
  };
  return map[key] ?? 'cell-pending';
}

export default function QuadrantPage() {
  const { runKey } = useParams<{ runKey: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<QuadrantData | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adjudicateState, setAdjudicateState] = useState<Record<string, AdjudicateState>>({});
  const [adjudicateError, setAdjudicateError] = useState<Record<string, string>>({});
  const [ackState, setAckState] = useState<AckState>('idle');
  const [ackError, setAckError] = useState('');
  const [ackNote, setAckNote] = useState('');
  const [closeError, setCloseError] = useState('');
  const [ritualNotified, setRitualNotified] = useState(false);
  const [localMatrix, setLocalMatrix] = useState<Cell[]>([]);

  const isReviewer = user?.email?.includes('reviewer') ||
    (user as { role?: string } | null)?.role === 'reviewer';

  const load = async () => {
    try {
      const res = await adminFetch(`/api/staff/acceptance/quadrant?run_key=${runKey}`, user);
      const json = await res.json() as QuadrantData;
      if (json.availability === 'degraded') {
        setDegraded(true);
        return;
      }
      setData(json);
      setLocalMatrix(json.matrix ?? []);
    } catch {
      setDegraded(true);
    }
  };

  useEffect(() => { void load(); }, [runKey]);

  const handleAdjudicate = async (cellId: string, verdict: '绿' | '红') => {
    setAdjudicateState((s) => ({ ...s, [cellId]: 'submitting' }));
    setAdjudicateError((e) => ({ ...e, [cellId]: '' }));
    try {
      const res = await adminFetch('/api/staff/acceptance/adjudication', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_key: runKey, cell_id: cellId, verdict }),
      });
      if (!res.ok) throw new Error('adjudication failed');
      setAdjudicateState((s) => ({ ...s, [cellId]: 'success' }));
      setLocalMatrix((m) =>
        m.map((c) =>
          c.cell_id === cellId
            ? { ...c, adjudicated: true, adjudicated_verdict: verdict }
            : c
        )
      );
    } catch {
      setAdjudicateState((s) => ({ ...s, [cellId]: 'error' }));
      setAdjudicateError((e) => ({ ...e, [cellId]: '裁决失败，请重试' }));
    }
  };

  const handleAck = async () => {
    setAckState('submitting');
    try {
      const res = await adminFetch('/api/staff/acceptance/review-ack', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_key: runKey, note: ackNote || undefined }),
      });
      if (!res.ok) throw new Error('ack failed');
      setAckState('done');
    } catch {
      setAckState('error');
      setAckError('提交失败，请重试');
    }
  };

  const handleClosedReview = async () => {
    setCloseError('');
    try {
      const res = await adminFetch('/api/staff/acceptance/review-closed', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_key: runKey }),
      });
      if (res.status === 403) {
        setCloseError('权限不足，只有发起人或主理人可关闭复盘');
        return;
      }
      if (!res.ok) throw new Error('close failed');
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('close failed')) {
        setCloseError('权限不足，只有发起人或主理人可关闭复盘');
      } else {
        setCloseError('关闭失败，请重试');
      }
    }
  };

  if (degraded) {
    return (
      <div>
        <Link to={`/acceptance/${runKey}`}>← 返回详情</Link>
        <div data-testid="quadrant-degraded-banner" style={{ padding: '20px', background: '#fbe9e9', borderRadius: '8px', marginTop: '16px' }}>
          合看系统暂时无法连接，请稍后重试
        </div>
      </div>
    );
  }

  if (!data) {
    return <p>加载中...</p>;
  }

  if (!data.human_complete) {
    return (
      <div>
        <Link to={`/acceptance/${runKey}`}>← 返回详情</Link>
        <div data-testid="quadrant-locked" style={{ padding: '20px', background: '#fbf1dd', borderRadius: '8px', marginTop: '16px' }}>
          员工验收未完成，合看页暂不可用
        </div>
      </div>
    );
  }

  const groupedByStep = localMatrix.reduce<Record<number, Cell[]>>((acc, cell) => {
    const step = cell.step ?? 0;
    (acc[step] ??= []).push(cell);
    return acc;
  }, {});

  return (
    <div>
      <Link to={`/acceptance/${runKey}`}>← 返回详情</Link>
      <h1>合看矩阵 — {runKey}</h1>

      {ritualNotified && (
        <div data-testid="ritual-notification" style={{ padding: '10px', background: '#e6f4ee', borderRadius: '6px', marginBottom: '12px' }}>
          新仪式已发起
        </div>
      )}

      <div data-testid="quadrant-matrix" style={{ overflowX: 'auto' }}>
        {Object.entries(groupedByStep).sort(([a], [b]) => Number(a) - Number(b)).map(([step, cells]) => (
          <section
            key={step}
            data-step14={String(step) === '14' ? 'true' : undefined}
            style={{
              background: String(step) === '14' ? '#f0f0f0' : undefined,
              marginBottom: '16px',
            }}
          >
            <h3>第 {step} 步</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {cells.map((cell) => {
                const divergent = isDivergent(cell);
                const isExpanded = expanded[cell.cell_id];
                const adjState = adjudicateState[cell.cell_id];

                return (
                  <div
                    key={cell.cell_id}
                    data-divergence={divergent ? 'true' : undefined}
                    data-cell-id={cell.cell_id}
                    style={{
                      border: '1px solid #dde2ea',
                      borderRadius: '8px',
                      padding: '12px',
                      minWidth: '200px',
                      cursor: divergent ? 'pointer' : 'default',
                      background: cell.na ? '#f0f0f0' : undefined,
                    }}
                    onClick={() => {
                      if (divergent) {
                        setExpanded((e) => ({ ...e, [cell.cell_id]: !e[cell.cell_id] }));
                      }
                    }}
                  >
                    {cell.is_s13_c4 ? (
                      <div>
                        <div data-testid={`cell-${cell.scenario_id}-ai`}>本版无受控手段制造频控场景</div>
                        <div data-testid={`cell-${cell.scenario_id}-human`} style={{ fontSize: '12px', color: '#7a8494' }}>S13-c4 特殊图例</div>
                      </div>
                    ) : cell.na ? (
                      <div>
                        <div data-testid={`cell-${cell.scenario_id}-ai`} style={{ color: '#7a8494' }}>不适用</div>
                        <div data-testid={`cell-${cell.scenario_id}-human`} style={{ color: '#7a8494' }}>不适用</div>
                      </div>
                    ) : (
                      <div>
                        <div data-testid={`cell-${cell.scenario_id}-ai`} className={cellColorClass(cell.ai_verdict ?? null, cell.human_verdict ?? null)}>
                          AI: {cell.ai_verdict ?? '—'}
                        </div>
                        <div data-testid={`cell-${cell.scenario_id}-human`}>
                          人工: {cell.human_verdict ?? '—'}
                        </div>
                        {cell.scenario_class && <div style={{ fontSize: '11px', color: '#5a6472' }}>{cell.scenario_class}</div>}
                        {cell.device && <div style={{ fontSize: '11px', color: '#5a6472' }}>{cell.device}</div>}
                        {cell.adjudicated && (
                          <div style={{ fontSize: '12px', fontWeight: 'bold' }}>主理人已裁决: {cell.adjudicated_verdict}</div>
                        )}

                        {divergent && isExpanded && (
                          <div
                            data-testid={`divergence-${cell.cell_id}`}
                            style={{ display: 'flex', gap: '12px', marginTop: '8px', borderTop: '1px solid #dde2ea', paddingTop: '8px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div data-testid={`divergence-ai-${cell.cell_id}`} style={{ flex: 1 }}>
                              <strong>AI 证据</strong>
                              <p>{cell.ai_evidence ?? '无证据链接'}</p>
                            </div>
                            <div data-testid={`divergence-human-${cell.cell_id}`} style={{ flex: 1 }}>
                              <strong>人工意见</strong>
                              <p>{cell.human_note ?? '无意见'}</p>
                            </div>

                            {isReviewer && !cell.adjudicated && (
                              <div data-testid={`adjudication-${cell.cell_id}`} style={{ marginTop: '8px' }}>
                                <button
                                  data-testid={`adjudicate-green-${cell.cell_id}`}
                                  disabled={adjState === 'submitting'}
                                  onClick={() => void handleAdjudicate(cell.cell_id, '绿')}
                                  style={{ marginRight: '8px' }}
                                >
                                  {adjState === 'submitting' ? '裁决中...' : '判绿'}
                                </button>
                                <button
                                  data-testid={`adjudicate-red-${cell.cell_id}`}
                                  disabled={adjState === 'submitting'}
                                  onClick={() => void handleAdjudicate(cell.cell_id, '红')}
                                >
                                  {adjState === 'submitting' ? '裁决中...' : '判红'}
                                </button>
                                {adjState === 'error' && (
                                  <p style={{ color: 'red' }}>{adjudicateError[cell.cell_id]}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div style={{ marginTop: '20px', borderTop: '1px solid #dde2ea', paddingTop: '16px' }}>
        {!isReviewer && ackState !== 'done' && (
          <div>
            <button
              data-testid="review-ack-btn"
              disabled={ackState === 'submitting'}
              onClick={() => void handleAck()}
            >
              {ackState === 'submitting' ? '提交中...' : '我已看过裁决'}
            </button>
            <textarea
              data-testid="review-ack-note"
              placeholder="异议说明（选填）"
              value={ackNote}
              onChange={(e) => setAckNote(e.target.value)}
              style={{ display: 'block', marginTop: '8px', width: '100%' }}
            />
            {ackState === 'error' && <p style={{ color: 'red' }}>{ackError}</p>}
          </div>
        )}
        {ackState === 'done' && (
          <button data-testid="review-ack-btn" disabled>
            已确认
          </button>
        )}

        {isReviewer && (
          <div style={{ marginTop: '12px' }}>
            <button
              data-testid="review-closed-btn"
              onClick={() => void handleClosedReview()}
            >
              关闭复盘
            </button>
            {closeError && <p style={{ color: 'red' }}>{closeError}</p>}
          </div>
        )}
      </div>

      <div style={{ marginTop: '12px' }}>
        <Link to="/acceptance/new" style={{ fontSize: '14px' }}>+ 发起新验收</Link>
      </div>
    </div>
  );
}
