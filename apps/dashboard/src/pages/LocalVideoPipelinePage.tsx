import { useState, useRef, useCallback, useEffect, type ComponentType } from 'react';
import { Upload, Image, FileText, Play, Download, Loader2, CheckCircle, XCircle, Film } from 'lucide-react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

type JobStatus = 'idle' | 'queued' | 'in_progress' | 'completed' | 'failed';

interface JobState {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
}

async function uploadVideo(video: File, logo: File | null, script: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('video', video);
  if (logo) form.append('logo', logo);
  form.append('script', script);
  const res = await axios.post(`${API_BASE}/ai-video/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  });
  return res.data;
}

async function pollStatus(id: string): Promise<JobState> {
  const res = await axios.get(`${API_BASE}/ai-video/task/${id}`);
  return { id, ...res.data };
}

function downloadUrl(jobId: string, file: '9_16.mp4' | '16_9.mp4'): string {
  return `${API_BASE}/ai-video/download/${jobId}/${file}`;
}

function DropZone({
  label,
  accept,
  file,
  onChange,
  icon: Icon,
}: {
  label: string;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
  icon: ComponentType<{ className?: string }>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: { preventDefault: () => void; dataTransfer: DataTransfer }) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onChange(f);
    },
    [onChange],
  );

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-all cursor-pointer p-6 min-h-[140px] ${
        dragging
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
          : file
          ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 hover:border-blue-300 hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <CheckCircle className="w-8 h-8 text-emerald-500" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 text-center break-all px-2">
            {file.name}
          </p>
          <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          <button
            className="text-xs text-slate-400 hover:text-red-500 underline mt-1"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
          >
            移除
          </button>
        </>
      ) : (
        <>
          <Icon className="w-8 h-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
          <p className="text-xs text-slate-400">点击或拖拽上传</p>
        </>
      )}
    </div>
  );
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
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [script, setScript] = useState('');
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const startPoll = useCallback((id: string) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const state = await pollStatus(id);
        setJob(state);
        if (state.status === 'completed' || state.status === 'failed') {
          stopPoll();
        }
      } catch {
        // silent — keep polling
      }
    }, 3000);
  }, [stopPoll]);

  const handleSubmit = async () => {
    if (!videoFile || !script.trim()) return;
    setSubmitting(true);
    try {
      const { id } = await uploadVideo(videoFile, logoFile, script);
      const initial: JobState = { id, status: 'queued', progress: 0 };
      setJob(initial);
      startPoll(id);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error || err.message : String(err);
      setJob({ id: '', status: 'failed', progress: 0, error: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    stopPoll();
    setJob(null);
    setVideoFile(null);
    setLogoFile(null);
    setScript('');
  };

  const isProcessing = job && (job.status === 'queued' || job.status === 'in_progress');
  const isDone = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
  const canSubmit = !!videoFile && !!script.trim() && !submitting && !isProcessing;

  const statusLabel: Record<JobStatus, string> = {
    idle: '',
    queued: '排队中…',
    in_progress: `处理中 ${job?.progress ?? 0}%`,
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
          上传视频，AI 自动剪掉静音段，输出 9:16 和 16:9 两种格式
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6">
        {/* 上传区 */}
        <div className="grid grid-cols-2 gap-4">
          <DropZone
            label="主视频"
            accept="video/*"
            file={videoFile}
            onChange={setVideoFile}
            icon={Upload}
          />
          <DropZone
            label="Logo / 水印图片（可选）"
            accept="image/*"
            file={logoFile}
            onChange={setLogoFile}
            icon={Image}
          />
        </div>

        {/* 标题/文案 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            视频标题 / 文案
          </label>
          <textarea
            rows={3}
            placeholder="输入视频标题或文案…"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            disabled={!!isProcessing || isDone}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
          />
        </div>

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
