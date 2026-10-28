import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Download, Film, Loader2, Sparkles, Upload, X } from 'lucide-react';

type Kind = 'wan' | 'upscale';
type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown';
interface Job { id: string; kind: Kind; status: JobStatus; videoUrl?: string; error?: string; createdAt: string }
interface UploadedMedia { id: string; url: string; kind: 'image' | 'video'; name: string }
interface Configuration { wan: { configured: boolean }; upscale: { configured: boolean }; uploads: { configured: boolean } }
const BASE = '/api/video-tools';
const TERMINAL = new Set<JobStatus>(['succeeded', 'failed', 'canceled', 'unknown']);
const STATUS: Record<JobStatus, string> = { pending: '排队中', running: '处理中', succeeded: '已完成', failed: '处理失败', canceled: '已取消', unknown: '状态未知' };
const field = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...init, credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || (response.status === 401 ? '登录已失效，请重新登录' : '请求失败，请稍后重试'));
  return body as T;
}

export default function VideoToolsPage({ kind }: { kind: Kind }) {
  const isWan = kind === 'wan';
  const [config, setConfig] = useState<Configuration | null>(null);
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState('720P');
  const [ratio, setRatio] = useState('adaptive');
  const [duration, setDuration] = useState(5);
  const [audio, setAudio] = useState(true);
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pollRevision, setPollRevision] = useState(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const uploadOperation = useRef<AbortController | null>(null);
  const retryKey = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request<Configuration>('/config', { signal: controller.signal }).then(setConfig).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    request<{ jobs: Job[] }>('/jobs', { signal: controller.signal }).then(result => setJobs(result.jobs.filter(item => item.kind === kind))).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => { mounted.current = false; controller.abort(); operation.current?.abort(); uploadOperation.current?.abort(); };
  }, [kind]);

  function remember(next: Job) {
    setJob(next);
    setJobs(previous => [next, ...previous.filter(item => item.id !== next.id)].slice(0, 30));
  }

  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await request<Job>(`/jobs/${encodeURIComponent(job.id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        remember(next);
        setPollError('');
        if (!TERMINAL.has(next.status)) timer = setTimeout(refresh, 15_000);
      } catch (err) {
        if (!controller.signal.aborted) {
          setPollError(err instanceof Error ? err.message : '暂时无法查询进度');
          timer = setTimeout(refresh, 15_000);
        }
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
    // A selected task owns its polling loop; status changes do not create overlapping requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, pollRevision]);

  async function upload(files: FileList | null) {
    if (!files?.length || uploading || busyRef.current) return;
    setError('');
    const selected = Array.from(files);
    const valid = selected.every(file => file.size > 0 && file.size <= 100 * 1024 * 1024 && (file.type.startsWith('video/') || (isWan && file.type.startsWith('image/'))));
    if (!valid) { setError('请选择不超过 100 MB 的有效' + (isWan ? '图片或视频' : '视频') + '文件'); return; }
    if (isWan && (media.length + selected.length > 15 || media.filter(item => item.kind === 'image').length + selected.filter(file => file.type.startsWith('image/')).length > 10 || media.filter(item => item.kind === 'video').length + selected.filter(file => file.type.startsWith('video/')).length > 5)) {
      setError('最多上传 10 张参考图片和 5 段参考视频'); return;
    }
    const controller = new AbortController();
    uploadOperation.current = controller;
    setUploading(true);
    try {
      const uploaded: UploadedMedia[] = [];
      for (const file of (isWan ? selected : selected.slice(0, 1))) {
        const body = new FormData();
        body.append('file', file);
        uploaded.push(await request<UploadedMedia>('/uploads', { method: 'POST', body, signal: controller.signal }));
      }
      if (!controller.signal.aborted) setMedia(previous => isWan ? [...previous, ...uploaded] : uploaded);
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '上传失败，请重试'); }
    finally { if (mounted.current) setUploading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || uploading || (job && !TERMINAL.has(job.status)) || !config?.[kind].configured || (isWan ? !prompt.trim() : !media[0])) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setPollError('');
    const controller = new AbortController();
    operation.current = controller;
    const body = isWan ? {
      kind, prompt: prompt.trim(), resolution, ratio, duration, audio,
      media: media.map(item => ({ type: item.kind === 'image' ? 'reference_image' : 'reference_video', url: item.url })),
    } : { kind, videoUrl: media[0].url, bitRate: 10 };
    const fingerprint = JSON.stringify(body);
    if (retryKey.current?.fingerprint !== fingerprint) retryKey.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const next = await request<Job>('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clientRequestId: retryKey.current.id }), signal: controller.signal });
      if (!controller.signal.aborted) { remember(next); retryKey.current = null; }
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '提交失败，请重试'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  const pending = !!job && !TERMINAL.has(job.status);
  const ready = !!config?.[kind].configured;
  const canSubmit = ready && !busy && !uploading && !pending && (isWan ? !!prompt.trim() : !!media[0]);
  return (
    <div className="mx-auto max-w-6xl pb-10 text-slate-900 dark:text-slate-100">
      <Link to="/area/video-tools" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600"><ArrowLeft size={16} />视频工具</Link>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-violet-600">{isWan ? 'WAN 3.0' : 'VIDEO ENHANCEMENT'}</p><h1 className="text-3xl font-semibold tracking-tight">{isWan ? 'Wan Playground' : '视频超分'}</h1><p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{isWan ? '从一句描述开始，让参考素材变成新的视频。' : '上传一段视频，以两倍尺寸还原更清晰的细节。'}</p></div>
        <Link to={isWan ? '/video-upscale' : '/wan-playground'} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm hover:border-violet-400 dark:border-slate-700 dark:bg-slate-800">{isWan ? '视频超分' : 'Wan Playground'}<ArrowUpRight size={16} /></Link>
      </header>
      {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {config && !ready && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">服务尚未配置，请联系管理员</div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-5 flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-violet-500" />{isWan ? '创作设置' : '上传原视频'}</h2>
          {isWan && <label className="block text-sm font-medium" htmlFor="video-prompt">视频描述<textarea id="video-prompt" className={`${field} min-h-36 resize-y`} value={prompt} maxLength={5000} onChange={event => setPrompt(event.target.value)} placeholder="例如：参考图中的人物走在海边，镜头缓缓推进，阳光温暖，海浪声自然。" required /></label>}
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">{isWan ? '参考素材（可选）' : '待超分视频'}</p>
            <label className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm dark:border-slate-600 dark:bg-slate-900 ${!config?.uploads.configured || uploading || busy || pending ? 'pointer-events-none opacity-50' : 'hover:border-violet-400'}`}>
              {uploading ? <Loader2 className="animate-spin text-violet-500" size={24} /> : <Upload className="text-violet-500" size={24} />}
              <span>{uploading ? '正在上传素材…' : isWan ? '选择图片或参考视频' : '选择一个视频文件'}</span>
              <span className="text-xs text-slate-400">每个文件最多 100 MB{isWan ? ' · 最多 10 张图、5 段视频' : ' · MP4 / MOV 等格式'}</span>
              <input aria-label={isWan ? '上传参考素材' : '上传待超分视频'} className="sr-only" type="file" accept={isWan ? 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime' : 'video/*'} multiple={isWan} disabled={!config?.uploads.configured || uploading || busy || pending} onChange={event => { void upload(event.target.files); event.target.value = ''; }} />
            </label>
            {config && !config.uploads.configured && <p className="mt-2 text-xs text-amber-700">素材上传尚未配置，请联系管理员{isWan ? '；仍可使用文字生成视频。' : '。'}</p>}
            <div className="mt-3 space-y-2">{media.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900"><Film size={15} className="shrink-0 text-slate-400" /><span className="min-w-0 flex-1 truncate">{item.name}</span><button aria-label={`移除 ${item.name}`} type="button" disabled={busy || pending || uploading} onClick={() => setMedia(previous => previous.filter(entry => entry.id !== item.id))} className="rounded p-1 text-slate-400 hover:text-red-500"><X size={16} /></button></div>)}</div>
          </div>
          {isWan ? <>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <label className="text-sm" htmlFor="video-resolution">清晰度<select id="video-resolution" className={field} value={resolution} onChange={event => setResolution(event.target.value)}>{['480P', '720P', '1080P'].map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm" htmlFor="video-ratio">画面比例<select id="video-ratio" className={field} value={ratio} onChange={event => setRatio(event.target.value)}>{[['adaptive', '自动'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['21:9', '21:9']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="text-sm" htmlFor="video-duration">时长（秒）<input id="video-duration" className={field} type="number" min={2} max={30} value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
            </div>
            <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-violet-600" checked={audio} onChange={event => setAudio(event.target.checked)} />同时生成声音</label>
            <p className="mt-4 text-xs leading-5 text-slate-400">参考视频单段 1–15 秒、总计不超过 15 秒；输入与输出视频总时长不超过 30 秒。</p>
          </> : <div className="mt-5 rounded-xl bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200"><p className="font-medium">两倍超分 · 自动增强细节</p><p className="mt-1 text-xs">原视频分辨率需大于 360 × 360、小于 1920 × 1080。保持原视频内容，以两倍尺寸输出。</p></div>}
          <button type="submit" disabled={!canSubmit} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">{busy || pending ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}{busy ? '正在提交…' : pending ? '任务处理中' : isWan ? '生成视频' : '开始超分'}</button>
          <p className="mt-3 text-center text-xs leading-5 text-slate-400">提交后会产生处理费用。任务已提交时无需重复操作。</p>
        </form>
        <section aria-label="处理结果" className="flex min-h-[480px] flex-col rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">{isWan ? '生成结果' : '超分结果'}</h2>{job && <span className={`rounded-full px-3 py-1 text-xs ${job.status === 'succeeded' ? 'bg-emerald-50 text-emerald-700' : job.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{STATUS[job.status]}</span>}</div>
          {job?.status === 'succeeded' && job.videoUrl ? <>
            <video data-testid="video-result" src={job.videoUrl} controls preload="metadata" className="aspect-video w-full rounded-xl bg-slate-950" />
            <div className="mt-5 flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 size={17} />视频已准备好</span><a href={`${BASE}/jobs/${encodeURIComponent(job.id)}/download?download=1`} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-violet-600"><Download size={16} />下载视频</a></div>
            <p className="mt-3 text-xs text-slate-400">请及时下载保存成片，结果链接可能过期。</p>
          </> : <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">{pending ? <Loader2 size={38} className="mb-4 animate-spin text-violet-500" /> : <Film size={38} className="mb-4 text-slate-300" />}<p className="text-sm font-medium">{pending ? '视频正在制作中' : job?.status === 'failed' ? '本次处理失败' : job?.status === 'canceled' ? '任务已取消' : job?.status === 'unknown' ? '任务状态未知' : '你的下一支视频，从这里开始'}</p><p className="mt-2 max-w-xs text-xs leading-6 text-slate-400">{job?.error || (pending ? '通常需要几分钟。可以离开页面，稍后从任务记录查看结果。' : job?.status === 'unknown' ? '任务可能已过期，请联系管理员确认。' : '完成左侧设置并提交后，结果会出现在这里。')}</p></div>}
          {pollError && <div role="alert" className="mt-4 text-sm text-amber-700">{pollError}<button type="button" className="ml-2 underline" onClick={() => setPollRevision(value => value + 1)}>重新查询</button></div>}
        </section>
      </div>
      <section className="mt-7"><h2 className="mb-3 text-sm font-semibold">我的任务记录</h2>{jobs.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{jobs.map(item => <button key={item.id} type="button" onClick={() => { setJob(item); setPollError(''); }} className={`rounded-xl border bg-white p-4 text-left text-sm dark:bg-slate-800 ${job?.id === item.id ? 'border-violet-400' : 'border-slate-200 dark:border-slate-700'}`}><span className="flex items-center justify-between"><span>{isWan ? '视频生成' : '视频超分'}</span><span className="text-xs text-slate-500">{STATUS[item.status]}</span></span><span className="mt-2 block text-xs text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</span></button>)}</div> : <p className="text-sm text-slate-400">还没有任务，完成第一次创作后会显示在这里。</p>}</section>
    </div>
  );
}
