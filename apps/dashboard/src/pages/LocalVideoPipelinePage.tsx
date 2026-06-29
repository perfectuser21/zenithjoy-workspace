import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, FileText, Play, Download, Loader2, CheckCircle, XCircle, Film } from 'lucide-react';
import axios from 'axios';
import TemplateSelector from '../components/video-pipeline/TemplateSelector';
import { fetchAccountMe } from '../api/account.api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

type JobStatus = 'idle' | 'queued' | 'pending' | 'processing' | 'completed' | 'failed';

interface JobState {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
}

async function createJob(
  localPath: string,
  topic: string,
  templateId: string | null,
  licenseKey: string,
  originalScript: string,
  targetAspect: '9:16' | '16:9' | null,
): Promise<{ id: string }> {
  const res = await axios.post(`${API_BASE}/ai-video/jobs`, {
    local_path: localPath,
    topic: topic || undefined,
    template_id: templateId || undefined,
    original_script: originalScript || null,
    target_aspect: targetAspect,
  }, {
    headers: { Authorization: `Bearer ${licenseKey}` },
  });
  return res.data.job;
}

function downloadUrl(jobId: string, file: '9_16.mp4' | '16_9.mp4'): string {
  return `${API_BASE}/ai-video/jobs/${jobId}/output/${file}`;
}

function ProgressBar({ progress, status }: { progress: number; status: JobStatus }) {
  const color = status === 'failed' ? 'bg-red-500' : status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500';
  return (
    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export default function LocalVideoPipelinePage() {
  const [localPath, setLocalPath] = useState('');
  const [topic, setTopic] = useState('');
  const [originalScript, setOriginalScript] = useState('');
  const [targetAspect, setTargetAspect] = useState<'9:16' | '16:9' | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const accountQuery = useQuery({
    queryKey: ['ws1', 'account-me'],
    queryFn: fetchAccountMe,
    retry: false,
    staleTime: 60_000,
  });
  const licenseKey = accountQuery.data?.license?.license_key ?? '';

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  useEffect(() => () => closeSse(), [closeSse]);

  const startSse = useCallback((id: string) => {
    closeSse();
    const es = new EventSource(`${API_BASE}/ai-video/jobs/${id}/sse`);
    sseRef.current = es;
    es.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data) as { id: string; status: string; progress: number; error?: string };
        setJob({ id: raw.id, status: raw.status as JobStatus, progress: raw.progress, error: raw.error });
        if (raw.status === 'completed' || raw.status === 'failed') {
          es.close();
          sseRef.current = null;
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        sseRef.current = null;
      }
    };
  }, [closeSse]);

  const handleSubmit = async () => {
    if (!localPath.trim() || !licenseKey) return;
    setSubmitting(true);
    try {
      const { id } = await createJob(localPath.trim(), topic, templateId, licenseKey, originalScript, targetAspect);
      const initial: JobState = { id, status: 'queued', progress: 0 };
      setJob(initial);
      startSse(id);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error || err.message : String(err);
      setJob({ id: '', status: 'failed', progress: 0, error: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    closeSse();
    setJob(null);
    setLocalPath('');
    setTopic('');
    setOriginalScript('');
    setTargetAspect(null);
    setTemplateId(null);
  };

  const isProcessing = job && (job.status === 'queued' || job.status === 'pending' || job.status === 'processing');
  const isDone = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
  const canSubmit = !!localPath.trim() && !!licenseKey && !submitting && !isProcessing;

  const statusLabel: Record<JobStatus, string> = {
    idle: '',
    queued: '排队中…',
    pending: '等待 Agent 处理…',
    processing: `Agent 处理中 ${job?.progress ?? 0}%`,
    completed: '处理完成',
    failed: '处理失败',
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Film className="w-7 h-7 text-blue-500" />
          本地视频处理
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          填入你 Windows 电脑上的视频路径，Agent 自动在本地精剪 + 字幕叠加，无需上传文件。
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6">
        {/* 本地路径输入 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4" />
            视频本地路径
          </label>
          <input
            type="text"
            placeholder="例：C:\Users\asus\Videos\my-video.mp4"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            disabled={!!isProcessing || isDone}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            填入你 Windows PC 上的视频文件完整路径，Agent 将直接读取该文件进行本地处理。
          </p>
        </div>

        {/* 标题/文案 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            视频标题 / 文案（可选）
          </label>
          <textarea
            rows={3}
            placeholder="输入视频主题或文案，AI 将据此生成字幕和镜头设计…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={!!isProcessing || isDone}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
          />
        </div>

        {/* 原始文案 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            原始文案（可选，录制前参考文案）
          </label>
          <textarea
            name="original_script"
            rows={3}
            placeholder="填写你录制视频前准备的参考文案，AI 生成场景文案时会参考这段内容…"
            value={originalScript}
            onChange={(e) => setOriginalScript(e.target.value)}
            disabled={!!isProcessing || isDone}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
          />
        </div>

        {/* 输出画幅 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            输出画幅（可选）
          </label>
          <div className="flex gap-2">
            {([null, '9:16', '16:9'] as const).map((v) => (
              <button
                key={v ?? 'auto'}
                type="button"
                onClick={() => setTargetAspect(v)}
                disabled={!!isProcessing || isDone}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 ${
                  targetAspect === v
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-400'
                }`}
              >
                {v === null ? '自动检测' : v}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            自动检测：Agent 读取视频尺寸后决定输出比例；手选 9:16/16:9 强制指定。
          </p>
        </div>

        {/* 模板选择 */}
        <TemplateSelector value={templateId} onChange={setTemplateId} />

        {/* 进度区 */}
        {job && job.status !== 'idle' && (
          <div className="space-y-2 p-4 bg-slate-50 dark:bg-slate-900/30 rounded-2xl">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                {isDone && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                {isFailed && <XCircle className="w-4 h-4 text-red-500" />}
                {statusLabel[job.status]}
              </span>
              <span className="text-slate-400 text-xs font-mono">{job.id ? `ID: ${job.id.slice(0, 8)}…` : ''}</span>
            </div>
            <ProgressBar progress={job.progress} status={job.status} />
            {isFailed && job.error && (
              <p className="text-xs text-red-500 mt-1">{job.error}</p>
            )}
          </div>
        )}

        {/* 下载区 */}
        {isDone && job && (
          <div className="grid grid-cols-2 gap-3">
            <a
              href={downloadUrl(job.id, '9_16.mp4')}
              download="9_16.mp4"
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-medium text-sm shadow-lg shadow-emerald-500/25 transition-all"
            >
              <Download className="w-4 h-4" />
              下载 9:16 竖屏
            </a>
            <a
              href={downloadUrl(job.id, '16_9.mp4')}
              download="16_9.mp4"
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-medium text-sm shadow-lg shadow-blue-500/25 transition-all"
            >
              <Download className="w-4 h-4" />
              下载 16:9 横屏
            </a>
          </div>
        )}

        {/* 操作按钮 */}
        {!licenseKey && !accountQuery.isLoading && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2 mb-1">
            未找到授权码 — 请确认已登录且账号已激活（注册后刷新页面）。
          </p>
        )}
        <div className="flex gap-3">
          {!isDone ? (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting || isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {submitting ? '提交中…' : isProcessing ? '处理中，请等待…' : '开始处理'}
            </button>
          ) : (
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold text-sm transition-all"
            >
              处理新视频
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
