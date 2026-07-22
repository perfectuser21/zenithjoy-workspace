import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

const API_UPLOAD = '/api/staff/skill-eval/upload';
const API_STATUS = (jobId: string) => `/api/staff/skill-eval/status/${jobId}`;
const API_REPORT = (jobId: string) => `/api/staff/skill-eval/report/${jobId}`;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const PLATFORM_OPTIONS = ['Claude', 'Codex', 'ChatGPT', 'Other'];
const JOURNEY_OPTIONS = [
  { value: 'line00', label: 'Line 00 — ZenithJoy 运营中枢' },
  { value: 'line01', label: 'Line 01 — 智能发布' },
  { value: 'line02', label: 'Line 02 — 客户智能获客路径' },
  { value: 'line04', label: 'Line 04 — 客户私域 AI 接管' },
];

type PageState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'polling'; jobId: string; startedAt: number }
  | { phase: 'done'; jobId: string; reportHtml: string }
  | { phase: 'failed'; jobId: string; reason: string }
  | { phase: 'error'; message: string };

export default function SkillEvalPage() {
  const { user } = useAuth();
  const [state, setState] = useState<PageState>({ phase: 'idle' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState('');
  const [journeyId, setJourneyId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const fetchReport = useCallback(async (jobId: string) => {
    try {
      const res = await adminFetch(API_REPORT(jobId), user);
      if (!res.ok) {
        setState({ phase: 'error', message: `报告获取失败（${res.status}）` });
        return;
      }
      const reportHtml = await res.text();
      setState({ phase: 'done', jobId, reportHtml });
    } catch {
      setState({ phase: 'error', message: '报告获取失败（网络错误，请检查连接）' });
    }
  }, [user?.email]);

  const poll = useCallback(async (jobId: string, startedAt: number) => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      stopPolling();
      setState({ phase: 'error', message: '评测服务暂不可用（轮询超时，请稍后重试）' });
      return;
    }

    try {
      const res = await adminFetch(API_STATUS(jobId), user);
      if (res.status === 504) {
        stopPolling();
        setState({ phase: 'error', message: '评测服务暂不可用（网关超时 504）' });
        return;
      }
      if (!res.ok) {
        stopPolling();
        setState({ phase: 'error', message: `评测状态查询失败（${res.status}）` });
        return;
      }
      const json = await res.json();
      const job = json.data ?? json;
      if (job.status === 'completed') {
        stopPolling();
        await fetchReport(jobId);
        return;
      }
      if (job.status === 'failed') {
        stopPolling();
        setState({ phase: 'failed', jobId, reason: job.failure_reason ?? '未知错误' });
        return;
      }
    } catch {
      // retry
    }

    pollTimerRef.current = setTimeout(() => {
      void poll(jobId, startedAt);
    }, POLL_INTERVAL_MS);
  }, [fetchReport, stopPolling, user?.email]);

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return;
    if (!platform) {
      setState({ phase: 'error', message: '请选择来源平台' });
      return;
    }
    if (!journeyId) {
      setState({ phase: 'error', message: '请选择归属线' });
      return;
    }

    setState({ phase: 'uploading' });
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('platform', platform);
    formData.append('journey_id', journeyId);

    try {
      const res = await adminFetch(API_UPLOAD, user, { method: 'POST', body: formData });
      if (res.status === 504) {
        setState({ phase: 'error', message: '评测服务暂不可用（网关超时 504）' });
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setState({ phase: 'error', message: err?.error?.message ?? `上传失败（${res.status}）` });
        return;
      }
      const json = await res.json();
      const jobId: string = json.data?.job_id ?? json.job_id;
      if (!jobId) {
        setState({ phase: 'error', message: '上传失败（服务未返回 job_id）' });
        return;
      }
      const startedAt = Date.now();
      setState({ phase: 'polling', jobId, startedAt });
      void poll(jobId, startedAt);
    } catch {
      setState({ phase: 'error', message: '上传失败（网络错误，请检查连接）' });
    }
  }, [journeyId, platform, poll, selectedFile, user?.email]);

  const handleReset = () => {
    stopPolling();
    setSelectedFile(null);
    setPlatform('');
    setJourneyId('');
    setState({ phase: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (state.phase === 'done') {
    return (
      <div className="card">
        <div className="section-title">
          <div>
            <h2>评测报告</h2>
            <p className="muted">job_id: {state.jobId}</p>
          </div>
          <button className="button secondary" onClick={handleReset}>
            重新上传
          </button>
        </div>
        <iframe
          title="skill-eval-report"
          data-testid="skill-eval-report-frame"
          className="report-frame"
          srcDoc={state.reportHtml}
          sandbox="allow-scripts allow-modals"
        />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-title">
        <div>
          <h2>Skill 验收</h2>
          <p className="muted">把 zip 交给 mmv 执行，Staff Hub 只负责员工鉴权、转发与展示。</p>
        </div>
      </div>

      <div className="form-grid">
        <label className="label">
          来源平台
          <select
            className="select"
            data-testid="skill-eval-platform"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            <option value="">请选择平台</option>
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="label">
          归属线
          <select
            className="select"
            data-testid="skill-eval-journey"
            value={journeyId}
            onChange={(event) => setJourneyId(event.target.value)}
          >
            <option value="">请选择归属线</option>
            {JOURNEY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="label">
          上传 skill zip
          <input
            ref={fileInputRef}
            className="input"
            data-testid="skill-eval-upload"
            type="file"
            accept=".zip"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {state.phase === 'polling' ? (
          <div className="pill" data-testid="skill-eval-job-id">
            评测中 · {state.jobId}
          </div>
        ) : null}
        {state.phase === 'failed' ? (
          <div className="error" data-testid="skill-eval-error">
            评测失败：{state.reason}
          </div>
        ) : null}
        {state.phase === 'error' ? (
          <div className="error" data-testid="skill-eval-error">
            {state.message}
          </div>
        ) : null}

        <div className="actions">
          <button
            className="button primary"
            data-testid="skill-eval-submit"
            onClick={() => void handleSubmit()}
            disabled={!selectedFile || state.phase === 'uploading' || state.phase === 'polling'}
          >
            {state.phase === 'uploading' ? '上传中...' : state.phase === 'polling' ? '评测中...' : '开始评测'}
          </button>
          <button className="button secondary" onClick={handleReset}>
            清空
          </button>
        </div>
      </div>
    </div>
  );
}
