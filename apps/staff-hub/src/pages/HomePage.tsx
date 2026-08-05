/**
 * HomePage → 员工工作台（Workbench）
 *
 * Task: 9cc10ff2 · 军师台三层之执行层（决策 af0d0818）
 * 形态对齐 employee-workbench-preview：关键指标 / 待处理门槛 / AI 后台任务 / 反馈网关。
 * 数据 GET /api/staff/workbench/summary；反馈 POST /api/staff/workbench/feedback
 * （进 Brain captures 收件箱，走 capture 去向链，处理后可反查来源）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Bot, ClipboardCheck, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/adminFetch';

type Summary = {
  availability: 'ready' | 'degraded';
  metrics: { pending_acceptance: number; ai_running: number; completed_7d: number };
  pending_runs: Array<{ run_key: string; gp_title: string | null; checks_total: number }>;
  ai_tasks: Array<{ id: string; title: string; task_type: string }>;
  message: string | null;
};

export default function HomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState('');
  const [feedbackIsIssue, setFeedbackIsIssue] = useState(false);
  const [feedbackLink, setFeedbackLink] = useState('');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminFetch('/api/staff/workbench/summary', user);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitFeedback = async () => {
    if (!feedback.trim() || sending) return;
    setSending(true);
    setReceipt(null);
    setSendError(null);
    try {
      const res = await adminFetch('/api/staff/workbench/feedback', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: feedback.trim(),
          ...(feedbackIsIssue ? { nature: 'issue' } : {}),
          ...(feedbackLink.trim() ? { link: feedbackLink.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setReceipt(data.capture.id);
      setFeedback('');
      setFeedbackLink('');
      setFeedbackIsIssue(false);
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <section className="hero">
        <div className="card" style={{ flex: 1 }}>
          <span className="pill">员工工作台</span>
          <h1 style={{ fontSize: '1.9rem', marginTop: 14 }}>今天轮到你判断的事</h1>
          <p className="muted">AI 负责提案、生成与自动测试；你只做现实判断。反馈从下方网关进箱，系统自动归位。</p>
          {summary?.availability === 'degraded' && (
            <p className="muted" style={{ color: '#b45309', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={16} /> 部分数据源降级：{summary.message}
            </p>
          )}
          {loadError && (
            <p className="muted" style={{ color: '#b91c1c' }}>加载失败：{loadError}</p>
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="button secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} /> {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>
      </section>

      <section className="kpi-grid">
        <div className="card">
          <h3><ClipboardCheck size={16} /> 待验收</h3>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>
            {summary ? summary.metrics.pending_acceptance : '—'}
          </p>
          <p className="muted">等你出判定的验收 run</p>
        </div>
        <div className="card">
          <h3><Bot size={16} /> AI 在跑</h3>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>
            {summary ? summary.metrics.ai_running : '—'}
          </p>
          <p className="muted">Cecelia 后台执行中的任务</p>
        </div>
        <div className="card">
          <h3><Activity size={16} /> 近 7 天完成</h3>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>
            {summary ? summary.metrics.completed_7d : '—'}
          </p>
          <p className="muted">系统近一周交付的任务数</p>
        </div>
      </section>

      <section className="hero" style={{ marginTop: 18 }}>
        <div className="card" style={{ flex: 1 }}>
          <h2>待处理门槛</h2>
          {summary && summary.pending_runs.length === 0 && (
            <p className="muted">当前没有等你的验收项。</p>
          )}
          <div className="list">
            {summary?.pending_runs.map((r) => (
              <div className="list-row" key={r.run_key}>
                <ClipboardCheck size={18} />
                <div style={{ flex: 1 }}>
                  <Link to={`/acceptance/${r.run_key}`}>{r.gp_title || r.run_key}</Link>
                  <p className="muted" style={{ margin: 0 }}>{r.checks_total} 项检查等待判定</p>
                </div>
                <Link className="button primary" to={`/acceptance/${r.run_key}`}>开始验收</Link>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ flex: 1 }}>
          <h2>AI 后台任务</h2>
          {summary && summary.ai_tasks.length === 0 && (
            <p className="muted">Cecelia 当前空闲。</p>
          )}
          <div className="list">
            {summary?.ai_tasks.slice(0, 8).map((t) => (
              <div className="list-row" key={t.id}>
                <Bot size={18} />
                <p className="muted" style={{ margin: 0, flex: 1 }}>{t.title}</p>
                <span className="pill">{t.task_type}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hero" style={{ marginTop: 18 }}>
        <div className="card" style={{ flex: 1 }}>
          <h2>反馈网关</h2>
          <p className="muted">看到不对的、想要的、卡住的，写在这——进 Cecelia 收件箱后自动归位路由，处理去向可回查。</p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="例：验收页 GP-X 的第 3 项检查描述和实际界面对不上……"
            rows={4}
            style={{ width: '100%', marginTop: 8 }}
          />
          <input
            value={feedbackLink}
            onChange={(e) => setFeedbackLink(e.target.value)}
            placeholder="相关链接（可选：PR / 截图 / 页面地址）"
            style={{ width: '100%', marginTop: 8 }}
          />
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={feedbackIsIssue}
              onChange={(e) => setFeedbackIsIssue(e.target.checked)}
            />
            这是一个问题（bug/故障），需要修
          </label>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="button primary" onClick={() => void submitFeedback()} disabled={sending || !feedback.trim()}>
              <Send size={16} /> {sending ? '提交中...' : '提交反馈'}
            </button>
          </div>
          {receipt && (
            <p className="muted" style={{ color: '#15803d', marginTop: 8 }}>
              已进箱，回执 #{receipt.slice(0, 8)}——处理后可在收件箱查去向。
            </p>
          )}
          {sendError && (
            <p className="muted" style={{ color: '#b91c1c', marginTop: 8 }}>提交失败：{sendError}</p>
          )}
        </div>
      </section>
    </>
  );
}
