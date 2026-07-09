import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

const API_UPLOAD = '/api/staff/skill-eval/upload';
const API_STATUS = (jobId: string) => `/api/staff/skill-eval/status/${jobId}`;
const API_REPORT = (jobId: string) => `/api/staff/skill-eval/report/${jobId}`;
const POLL_INTERVAL_MS = 3000;
// 真实 skill 评测（claude 真实调用）耗时可达数分钟——worker 侧 STUCK_TIMEOUT_MINUTES
// 默认 15 分钟才算真正卡死，60 秒的旧值只在近乎空壳的测试 skill 上凑巧没超时，
// 真实用户上传后端已 completed 却被前端提前误报"轮询超时"（真实复现）。
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 组件卸载（用户离开这个页面）时停止轮询，避免残留的 setTimeout 在后台继续跑
  useEffect(() => stopPolling, [stopPolling]);

  const fetchReport = useCallback(async (jobId: string) => {
    try {
      // 默认拿下游团队做好的完整可视化 HTML 报告（skill-eval-report-render.js），
      // 不再自己拼一张简陋卡片重新发明展示层
      const res = await adminFetch(API_REPORT(jobId), user?.email);
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
    const elapsed = Date.now() - startedAt;
    if (elapsed > POLL_TIMEOUT_MS) {
      stopPolling();
      setState({ phase: 'error', message: '评测服务暂不可用（轮询超时，请稍后重试）' });
      return;
    }

    try {
      const res = await adminFetch(API_STATUS(jobId), user?.email);
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
      // 网络错误继续重试
    }

    pollTimerRef.current = setTimeout(() => poll(jobId, startedAt), POLL_INTERVAL_MS);
  }, [stopPolling, user?.email, fetchReport]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (state.phase !== 'idle') setState({ phase: 'idle' });
  };

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return;
    setState({ phase: 'uploading' });

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await adminFetch(API_UPLOAD, user?.email, { method: 'POST', body: formData });
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
      poll(jobId, startedAt);
    } catch {
      setState({ phase: 'error', message: '上传失败（网络错误，请检查连接）' });
    }
  }, [selectedFile, poll, user?.email]);

  const handleReset = () => {
    stopPolling();
    setSelectedFile(null);
    setState({ phase: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Skill 评测上传</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm">
        上传技能包 zip，系统将自动评测并生成报告（员工内部工具）
      </p>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 space-y-4">
        {/* 文件选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            选择技能包（.zip）
          </label>
          <input
            ref={fileInputRef}
            data-testid="skill-eval-upload"
            type="file"
            accept=".zip"
            onChange={handleFileChange}
            disabled={state.phase === 'uploading' || state.phase === 'polling'}
            className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300 disabled:opacity-50"
          />
          {selectedFile && (
            <p className="mt-1 text-xs text-gray-500">
              已选择：{selectedFile.name}（{(selectedFile.size / 1024).toFixed(1)} KB）
            </p>
          )}
        </div>

        {/* 上传按钮 */}
        <button
          data-testid="skill-eval-submit"
          onClick={handleSubmit}
          disabled={!selectedFile || state.phase === 'uploading' || state.phase === 'polling'}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
        >
          {state.phase === 'uploading' ? '上传中...' : state.phase === 'polling' ? '评测中...' : '开始上传评测'}
        </button>

        {/* 状态显示 */}
        {state.phase === 'uploading' && (
          <div data-testid="skill-eval-loading" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            正在上传文件...
          </div>
        )}

        {state.phase === 'polling' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              评测中，请稍候...
            </div>
            <p data-testid="skill-eval-job-id" className="text-xs text-gray-400">
              任务 ID：{state.jobId}
            </p>
          </div>
        )}

        {state.phase === 'error' && (
          <div data-testid="skill-eval-error" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
            <button onClick={handleReset} className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:no-underline">
              重新选择文件
            </button>
          </div>
        )}

        {state.phase === 'done' && (
          <div data-testid="skill-eval-report" className="space-y-2">
            <iframe
              title="评测报告"
              data-testid="skill-eval-report-frame"
              srcDoc={state.reportHtml}
              sandbox=""
              className="w-full rounded-xl border border-gray-200 dark:border-slate-700"
              style={{ height: '80vh' }}
            />
            <button onClick={handleReset} className="text-xs text-blue-700 dark:text-blue-400 underline hover:no-underline">
              重新上传
            </button>
          </div>
        )}

        {state.phase === 'failed' && (
          <div data-testid="skill-eval-error" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">
              评测失败：{state.reason}
            </p>
            <button onClick={handleReset} className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:no-underline">
              重新上传
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
