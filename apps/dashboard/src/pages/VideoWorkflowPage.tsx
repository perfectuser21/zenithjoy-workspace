import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  Film,
  Loader2,
  Plus,
  RefreshCw,
  Scissors,
  Upload,
} from 'lucide-react';
import {
  VIDEO_WORKFLOW_BASE as BASE,
  videoWorkflowRequest as request,
  uploadWorkflowAsset,
  type VideoProject,
  type WorkflowJob,
  type WorkflowRemake,
  type WorkflowSegment,
} from '../api/video-workflow.api';

const panel =
  'rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const field =
  'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950';
const primary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40';
const secondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700';
const stages = ['上传原片', '确认分镜', '分段修改', '合成导出'];
const statusText = {
  splitting: '正在分析和切段',
  review: '等待确认分镜',
  editing: '分段修改中',
  assembling: '正在合成成片',
  completed: '成片已完成',
  failed: '需要处理问题',
};
const active = (segment: WorkflowSegment) =>
  segment.job?.status === 'pending' || segment.job?.status === 'running';
function time(value: number) {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`;
}
function defaults(segment: WorkflowSegment): WorkflowRemake {
  return (
    segment.remake ?? {
      referenceAssetId: segment.assetId,
      productMode: 'keep',
      background: false,
      face: false,
      facePresence: 'unknown',
    }
  );
}
function valid(value: WorkflowRemake) {
  if (
    value.productMode === 'replace' &&
    (!value.productAssetId || !value.productDescription?.trim())
  )
    return false;
  if (value.productMode === 'logo' && !value.productAssetId) return false;
  if (value.productMode === 'color' && !value.targetColor?.trim()) return false;
  if (value.background && !value.backgroundDescription?.trim() && !value.backgroundAssetId)
    return false;
  if (value.face && (value.facePresence !== 'present' || !value.faceAssetId)) return false;
  return value.productMode !== 'keep' || value.background || value.face;
}

export default function VideoWorkflowPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('project');
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<WorkflowRemake | null>(null);
  const draftValue = useRef(draft);
  draftValue.current = draft;
  const lastSavedDraft = useRef({ id: '', value: '' });
  const ownSavedDraft = useRef<string | null>(null);
  const [cuts, setCuts] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState('');
  const [generationReady, setGenerationReady] = useState(false);
  const [uploadsReady, setUploadsReady] = useState(false);
  const [reload, setReload] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const segment = project?.segments.find((item) => item.id === selected) ?? project?.segments[0];
  const ambiguousJob =
    segment?.job?.status === 'unknown' ||
    (segment?.job?.status === 'failed' && /未能确认|未确认|未知/.test(segment.job.error ?? ''));
  const number =
    project && segment ? project.segments.findIndex((item) => item.id === segment.id) + 1 : 0;
  const dirty = !!segment && !!draft && JSON.stringify(draft) !== JSON.stringify(defaults(segment));
  const approved = project?.segments.filter((item) => item.approved).length ?? 0;
  const processing = project?.status === 'splitting' || project?.status === 'assembling';
  const phase = !project
    ? 0
    : !project.confirmed
      ? 1
      : project.status === 'completed' || project.status === 'assembling'
        ? 3
        : 2;
  const remember = useCallback((next: VideoProject) => {
    setProject(next);
    setProjects((list) => [next, ...list.filter((item) => item.id !== next.id)]);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request<{ wan: { configured: boolean }; uploads: { configured: boolean } }>(
      '/config',
      undefined,
      'GET',
      controller.signal
    )
      .then((config) => {
        setGenerationReady(config.wan.configured);
        setUploadsReady(config.uploads.configured);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    request<{ projects: VideoProject[] }>('/projects', undefined, 'GET', controller.signal)
      .then((result) => setProjects(result.projects))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    operation.current?.abort();
    lock.current = false;
    setBusy(false);
    setUncertain('');
    setError('');
    setProject(null);
    setSelected('');
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    request<VideoProject>(
      `/projects/${encodeURIComponent(id)}`,
      undefined,
      'GET',
      controller.signal
    )
      .then((next) => {
        if (!controller.signal.aborted) remember(next);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, reload, remember]);
  // Compare persisted values rather than response object identities so polling cannot erase edits.
  const savedDraft = segment ? JSON.stringify(defaults(segment)) : '';
  const pendingAttempt = segment?.clientRequestId && !segment.jobId ? segment.id : '';
  const segmentId = segment?.id ?? '';
  useEffect(() => {
    const previous = lastSavedDraft.current;
    const local = draftValue.current;
    const changedLocally =
      previous.id === segmentId && local && JSON.stringify(local) !== previous.value;
    if (
      changedLocally &&
      ownSavedDraft.current !== savedDraft &&
      JSON.stringify(local) !== savedDraft
    ) {
      setError('此分段已被其他页面修改，请刷新核对后继续，当前草稿仍保留。');
    } else {
      setDraft(savedDraft ? (JSON.parse(savedDraft) as WorkflowRemake) : null);
    }
    lastSavedDraft.current = { id: segmentId, value: savedDraft };
    ownSavedDraft.current = null;
    setUncertain(pendingAttempt);
  }, [savedDraft, pendingAttempt, segmentId]);
  const suggestedCuts =
    project && !project.confirmed
      ? project.segments
          .slice(0, -1)
          .map((item) => Number(item.end.toFixed(3)))
          .join(', ')
      : '';
  useEffect(() => {
    setCuts(suggestedCuts);
  }, [suggestedCuts]);
  const projectId = project?.id;
  const hasActive = project?.segments.some(active);
  useEffect(() => {
    if (!projectId || (!processing && !hasActive)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await request<VideoProject>(
          `/projects/${projectId}`,
          undefined,
          'GET',
          controller.signal
        );
        if (!controller.signal.aborted) {
          remember(next);
          setError('');
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : '进度查询失败，请重新加载');
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
    };
    timer = setTimeout(refresh, 5000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, processing, hasActive, remember]);
  useEffect(() => () => operation.current?.abort(), []);
  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      await action(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : '操作未完成，请重试');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        lock.current = false;
        setBusy(false);
        setProgress('');
      }
    }
  }
  async function patch(
    body: Record<string, unknown>,
    signal: AbortSignal,
    expectedRevision = segment?.revision ?? 0
  ) {
    if (!project || !segment) throw new Error('请先选择片段');
    try {
      const next = await request<VideoProject>(
        `/projects/${project.id}/segments/${segment.id}`,
        { ...body, expectedRevision },
        'PATCH',
        signal
      );
      if (!signal.aborted) {
        const savedSegment = next.segments.find((item) => item.id === segment.id);
        ownSavedDraft.current = savedSegment ? JSON.stringify(defaults(savedSegment)) : null;
        remember(next);
      }
      return next;
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        throw Object.assign(
          new Error(
            `${error instanceof Error ? error.message : '分段已变化'}。请刷新核对后继续，当前草稿仍保留。`
          ),
          { status: 409 }
        );
      }
      throw error;
    }
  }

  function open(projectId: string | null) {
    setParams(projectId ? { project: projectId } : {});
  }
  function uploadOriginal(file?: File) {
    if (!file) return;
    if (!/\.(mp4|mov|webm)$/i.test(file.name)) {
      setError('请选择 MP4、MOV 或 WebM 视频');
      return;
    }
    void perform(async (signal) => {
      const asset = await uploadWorkflowAsset(file, setProgress, signal);
      if (signal.aborted) return;
      setProgress('正在创建视频项目…');
      const next = await request<VideoProject>(
        '/projects',
        {
          sourceAssetId: asset.id,
          name: file.name.replace(/\.[^.]+$/, ''),
          clientRequestId: crypto.randomUUID(),
        },
        'POST',
        signal
      );
      if (!signal.aborted) {
        open(next.id);
        remember(next);
      }
    });
  }
  function uploadImage(
    file: File | undefined,
    role: 'productAssetId' | 'backgroundAssetId' | 'faceAssetId'
  ) {
    if (!file) return;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setError('请选择 PNG、JPG 或 WebP 图片');
      return;
    }
    void perform(async (signal) => {
      const asset = await uploadWorkflowAsset(file, setProgress, signal);
      if (!signal.aborted)
        setDraft((previous) => (previous ? { ...previous, [role]: asset.id } : previous));
    });
  }
  function generate(retry = false) {
    if (!project || !segment || !draft || !valid(draft)) return;
    void perform(async (signal) => {
      const requestId =
        retry && segment.clientRequestId ? segment.clientRequestId : crypto.randomUUID();
      // Save before charging; use its returned revision for the later job association.
      let expectedRevision = segment.revision ?? 0;
      if (!retry) {
        const saved = await patch(
          { remake: draft, useOriginal: false, clientRequestId: requestId },
          signal,
          expectedRevision
        );
        expectedRevision =
          saved.segments.find((item) => item.id === segment.id)?.revision ?? expectedRevision + 1;
      }
      if (signal.aborted) return;
      let job: WorkflowJob;
      try {
        job = await request<WorkflowJob>(
          '/jobs',
          { kind: 'wan', clientRequestId: requestId, remake: draft },
          'POST',
          signal
        );
      } catch (err) {
        if (signal.aborted) return;
        const failure = err as Error & { status?: number };
        if (
          failure.status &&
          failure.status >= 400 &&
          failure.status < 500 &&
          ![409, 429].includes(failure.status)
        ) {
          try {
            await patch({ clientRequestId: null }, signal, expectedRevision);
            setUncertain('');
            setError(failure.message);
          } catch {
            setUncertain(segment.id);
            setError('提交结果尚未确认，请查询本次提交后再修改设置。');
          }
        } else {
          setUncertain(segment.id);
          setError(`提交结果尚未确认，请查询本次提交，避免重复计费。${failure.message || ''}`);
        }
        return;
      }
      try {
        await patch(
          { jobId: job.id, remake: draft, clientRequestId: requestId, useOriginal: false },
          signal,
          expectedRevision
        );
        setUncertain('');
      } catch {
        if (!signal.aborted) {
          setUncertain(segment.id);
          setError('提交结果尚未确认：任务可能已经建立，请刷新核对后查询本次提交以恢复关联。');
        }
      }
    });
  }
  function split(manual: boolean) {
    if (!project) return;
    const boundaries = cuts.trim()
      ? cuts
          .split(/[,，\s]+/)
          .filter(Boolean)
          .map(Number)
      : [];
    if (
      manual &&
      boundaries.some(
        (cut, i) =>
          !Number.isFinite(cut) ||
          cut <= 0 ||
          cut >= project.source.duration ||
          (i > 0 && cut <= boundaries[i - 1])
      )
    ) {
      setError('切点请按从小到大的秒数填写，位于视频起止时间之间');
      return;
    }
    void perform(async (signal) => {
      const next = await request<VideoProject>(
        `/projects/${project.id}/split`,
        manual ? { boundaries } : {},
        'POST',
        signal
      );
      if (!signal.aborted) remember(next);
    });
  }
  function setting(change: Partial<WorkflowRemake>) {
    setDraft((previous) => (previous ? { ...previous, ...change } : previous));
  }
  function imageField(label: string, role: 'productAssetId' | 'backgroundAssetId' | 'faceAssetId') {
    return (
      <label className="mt-3 block text-sm">
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={label}
          className={`${field} cursor-pointer`}
          onChange={(event) => uploadImage(event.target.files?.[0], role)}
        />
        {draft?.[role] && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check size={12} />
            素材已准备好
          </span>
        )}
      </label>
    );
  }
  return (
    <main className="mx-auto max-w-7xl pb-12 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex items-center justify-between text-sm">
        <Link
          to="/area/video-tools"
          className="inline-flex items-center gap-2 text-slate-500 hover:text-violet-600"
        >
          <ArrowLeft size={16} />
          视频工具
        </Link>
        <Link to="/creative-canvas/advanced" className="text-slate-400 hover:text-violet-600">
          高级编辑
        </Link>
      </div>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[.15em] text-violet-600">视频创作</p>
          <h1 className="text-3xl font-semibold tracking-tight">把整条视频，一步步改好</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            上传原片，确认分镜，再决定每一段怎么改。满意后，一键合成完整视频。
          </p>
        </div>
        {project && (
          <button className={secondary} disabled={busy} onClick={() => open(null)}>
            <Plus size={16} />
            新建视频
          </button>
        )}
      </header>
      <ol aria-label="制作步骤" className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stages.map((stage, index) => (
          <li
            key={stage}
            aria-current={phase === index ? 'step' : undefined}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${phase === index ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200' : 'border-slate-200 text-slate-400 dark:border-slate-800'}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${phase >= index ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
            >
              {phase > index ? <Check size={14} /> : index + 1}
            </span>
            {stage}
          </li>
        ))}
      </ol>
      {error && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span>{error}</span>
          <button className="shrink-0 underline" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </button>
        </div>
      )}
      {(busy || loading) && (
        <p role="status" className="mb-4 flex items-center gap-2 text-sm text-violet-600">
          <Loader2 size={16} className="animate-spin" />
          {progress || (loading ? '正在恢复项目…' : '正在保存…')}
        </p>
      )}
      {!project && !id && (
        <>
          <section className={`${panel} p-6 md:p-10`}>
            <label
              className={`flex min-h-64 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/40 p-8 text-center dark:border-violet-900 dark:bg-violet-950/20 ${busy || !uploadsReady ? 'opacity-50' : 'cursor-pointer hover:border-violet-400'}`}
            >
              <span className="mb-4 rounded-2xl bg-white p-4 text-violet-600 shadow-sm dark:bg-slate-900">
                <Upload size={30} />
              </span>
              <span className="text-lg font-semibold">从一条完整视频开始</span>
              <span className="mt-2 text-sm text-slate-500">
                45 秒、1 分钟都可以。系统按场景切段，你来确认。
              </span>
              <span className="mt-5 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white">
                选择原视频
              </span>
              <input
                type="file"
                aria-label="上传完整视频"
                accept="video/mp4,video/quicktime,video/webm"
                className="sr-only"
                disabled={busy || !uploadsReady}
                onChange={(event) => uploadOriginal(event.target.files?.[0])}
              />
              <span className="mt-3 text-xs text-slate-400">MP4 / MOV / WebM · 最多 100 MB</span>
            </label>
          </section>
          <section className="mt-8">
            <h2 className="mb-4 font-semibold">继续我的视频</h2>
            {projects.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {projects.map((item) => (
                  <button
                    key={item.id}
                    disabled={busy}
                    className={`${panel} p-4 text-left hover:border-violet-400`}
                    onClick={() => open(item.id)}
                  >
                    <div className="mb-3 flex items-center gap-2 text-violet-500">
                      <Film size={18} />
                      <span className="text-xs text-slate-500">{statusText[item.status]}</span>
                    </div>
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {item.segments?.length ?? 0} 个片段 · 点击继续
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">你的项目会保存在这里，随时回来继续。</p>
            )}
          </section>
        </>
      )}
      {project && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{project.name}</h2>
              <p className="mt-1 text-xs text-slate-500">
                原片 {time(project.source.duration)} · {project.segments.length} 个片段 ·{' '}
                {statusText[project.status]}
              </p>
            </div>
            <button
              className={secondary}
              disabled={busy}
              onClick={() => setReload((value) => value + 1)}
            >
              <RefreshCw size={14} />
              刷新进度
            </button>
          </div>
          {project.error && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {project.error}
            </div>
          )}
          {processing ? (
            <section
              className={`${panel} flex min-h-80 flex-col items-center justify-center p-8 text-center`}
            >
              <Loader2 size={36} className="mb-5 animate-spin text-violet-500" />
              <h2 className="text-lg font-semibold">{statusText[project.status]}</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
                {project.status === 'splitting'
                  ? '正在寻找场景切换点，并把较长场景拆成小于 15 秒的片段。完成后可以逐段播放和调整。'
                  : '正在按分镜顺序拼接，并恢复原片声音。完成后即可预览下载。'}
              </p>
              <p className="mt-4 text-xs text-slate-400">
                可以离开页面，稍后从“继续我的视频”回来。
              </p>
            </section>
          ) : project.status === 'completed' && project.outputUrl ? (
            <section className={`${panel} p-6`}>
              <div className="mb-4 flex items-center gap-2 font-semibold text-emerald-600">
                <Check size={20} />
                完整视频已准备好
              </div>
              <video
                aria-label="完整成片"
                src={project.outputUrl}
                controls
                preload="metadata"
                className="mx-auto max-h-[65vh] w-full rounded-xl bg-slate-950"
              />
              <div className="mt-5 flex justify-end">
                <a
                  href={`${BASE}/projects/${encodeURIComponent(project.id)}/download`}
                  className={primary}
                >
                  <Download size={16} />
                  下载完整视频
                </a>
              </div>
            </section>
          ) : !project.confirmed ? (
            <section className={`${panel} p-6`}>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">先看分镜，再继续</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    场景切点是系统建议。逐段播放，确认内容完整、切点合适后继续。
                  </p>
                </div>
                <button
                  className={secondary}
                  disabled={busy || !project.segments.length}
                  onClick={() => split(false)}
                >
                  <Scissors size={15} />
                  重新自动分段
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {project.segments.map((item, index) => (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
                  >
                    <video
                      aria-label={`片段 ${index + 1} 原片`}
                      src={item.videoUrl}
                      controls
                      preload="metadata"
                      className="aspect-video w-full bg-slate-950"
                    />
                    <div className="p-3">
                      <p className="text-sm font-medium">
                        片段 {index + 1}
                        <span className="float-right text-xs text-violet-600">
                          {(item.end - item.start).toFixed(1)} 秒
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {time(item.start)} — {time(item.end)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <details className="mt-5 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950">
                <summary className="cursor-pointer font-medium">调整切点</summary>
                <label className="mt-4 block">
                  切点（秒）
                  <input
                    aria-label="切点（秒）"
                    className={field}
                    value={cuts}
                    onChange={(event) => setCuts(event.target.value)}
                    placeholder="例如 8, 20, 30, 44, 53"
                    disabled={busy}
                  />
                </label>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  用逗号分隔。保留完整视频，过长片段继续拆短；每段至少 1 秒、小于 15 秒。
                </p>
                <button className={`${secondary} mt-3`} disabled={busy} onClick={() => split(true)}>
                  应用切点，重新分段
                </button>
              </details>
              <div className="mt-6 flex justify-end">
                <button
                  className={primary}
                  disabled={busy || !project.segments.length || project.status === 'failed'}
                  onClick={() =>
                    void perform(async (signal) => {
                      const next = await request<VideoProject>(
                        `/projects/${project.id}`,
                        { confirmed: true },
                        'PATCH',
                        signal
                      );
                      if (!signal.aborted) remember(next);
                    })
                  }
                >
                  确认分段，下一步
                  <ChevronRight size={16} />
                </button>
              </div>
            </section>
          ) : segment && draft ? (
            <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
              <aside className={`${panel} self-start p-3`}>
                <h2 className="px-2 py-2 text-sm font-semibold">
                  分镜列表{' '}
                  <span className="font-normal text-slate-400">
                    {approved}/{project.segments.length} 已确认
                  </span>
                </h2>
                <div className="space-y-2">
                  {project.segments.map((item, index) => (
                    <button
                      disabled={busy}
                      key={item.id}
                      onClick={() => setSelected(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${item.id === segment.id ? 'bg-violet-50 ring-1 ring-violet-200 dark:bg-violet-950/50 dark:ring-violet-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm ${item.approved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}
                      >
                        {item.approved ? <Check size={17} /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">片段 {index + 1}</span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {(item.end - item.start).toFixed(1)} 秒 ·{' '}
                          {item.approved
                            ? '已确认'
                            : active(item)
                              ? '生成中'
                              : item.job?.status === 'succeeded'
                                ? '待审核'
                                : item.job?.status === 'failed'
                                  ? '生成失败'
                                  : item.clientRequestId && !item.jobId
                                    ? '提交待确认'
                                    : '待修改'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
              <div className="space-y-5">
                <section className={`${panel} p-5 md:p-6`}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-semibold">
                      片段 {number}
                      <span className="ml-3 text-sm font-normal text-slate-400">
                        {time(segment.start)} — {time(segment.end)}
                      </span>
                    </h2>
                    {segment.approved && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                        已确认使用
                      </span>
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs text-slate-500">原片</p>
                      <video
                        aria-label={`片段 ${number} 原片`}
                        src={segment.videoUrl}
                        controls
                        preload="metadata"
                        className="aspect-video max-h-80 w-full rounded-xl bg-slate-950"
                      />
                    </div>
                    <div>
                      <p className="mb-2 text-xs text-slate-500">修改结果</p>
                      {segment.job?.status === 'succeeded' && segment.job.videoUrl ? (
                        <video
                          aria-label={`片段 ${number} 修改结果`}
                          src={segment.job.videoUrl}
                          controls
                          preload="metadata"
                          className="aspect-video max-h-80 w-full rounded-xl bg-slate-950"
                        />
                      ) : (
                        <div className="flex aspect-video flex-col items-center justify-center rounded-xl bg-slate-50 p-5 text-center text-slate-400 dark:bg-slate-950">
                          {active(segment) ? (
                            <Loader2 size={25} className="mb-3 animate-spin text-violet-500" />
                          ) : (
                            <Film size={25} className="mb-3" />
                          )}
                          <p className="text-sm">
                            {active(segment)
                              ? '这一段正在生成'
                              : segment.useOriginal
                                ? '这一段使用原片'
                                : segment.job?.status === 'failed'
                                  ? '这一段生成失败'
                                  : segment.job?.status === 'unknown'
                                    ? '生成状态待核实'
                                    : '设置好修改要求后，先试这一段'}
                          </p>
                          {segment.job?.error && (
                            <p className="mt-2 text-xs leading-5">{segment.job.error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {segment.job?.status === 'succeeded' && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">先对比画面，满意后确认使用。</p>
                      <button
                        className={primary}
                        disabled={busy || dirty || segment.approved}
                        onClick={() =>
                          void perform(async (signal) => {
                            await patch({ approved: true }, signal);
                          })
                        }
                      >
                        这一段满意，确认使用
                        <Check size={16} />
                      </button>
                    </div>
                  )}
                </section>
                <section className={`${panel} p-5 md:p-6`}>
                  <h2 className="font-semibold">这一段怎么改？</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    只选择需要修改的内容，其余画面尽量保持原样。
                  </p>
                  {segment.clientRequestId && !segment.jobId && (
                    <div
                      role="status"
                      className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
                    >
                      提交结果尚未确认，请先查询本次提交。
                      <button
                        className="ml-3 underline"
                        disabled={busy}
                        onClick={() => generate(true)}
                      >
                        查询本次提交
                      </button>
                    </div>
                  )}
                  {ambiguousJob && (
                    <p
                      role="status"
                      className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
                    >
                      请联系管理员核实本次任务，确认费用和结果后再创建新版本。
                    </p>
                  )}
                  <fieldset
                    disabled={
                      busy ||
                      ambiguousJob ||
                      active(segment) ||
                      !!uncertain ||
                      (!!segment.clientRequestId && !segment.jobId)
                    }
                    className="mt-5 space-y-4 disabled:opacity-60"
                  >
                    <div>
                      <label className="text-sm font-medium">
                        产品怎么改
                        <select
                          aria-label="产品怎么改"
                          className={field}
                          value={draft.productMode}
                          onChange={(event) =>
                            setting({
                              productMode: event.target.value as WorkflowRemake['productMode'],
                            })
                          }
                        >
                          <option value="keep">保持原产品</option>
                          <option value="replace">换成本店产品</option>
                          <option value="color">只改产品颜色</option>
                          <option value="logo">只换 Logo</option>
                        </select>
                      </label>
                      {draft.productMode !== 'keep' && (
                        <>
                          {draft.productMode !== 'color' &&
                            imageField(
                              draft.productMode === 'logo' ? '上传目标 Logo' : '上传本店产品图',
                              'productAssetId'
                            )}
                          {draft.productMode === 'replace' && (
                            <label className="mt-3 block text-sm">
                              产品说明
                              <input
                                className={field}
                                value={draft.productDescription ?? ''}
                                maxLength={1000}
                                placeholder="例如：黑白拼色加厚手套"
                                onChange={(event) =>
                                  setting({ productDescription: event.target.value })
                                }
                              />
                            </label>
                          )}
                          {draft.productMode === 'color' && (
                            <label className="mt-3 block text-sm">
                              目标颜色
                              <input
                                className={field}
                                value={draft.targetColor ?? ''}
                                maxLength={1000}
                                placeholder="例如：深蓝色"
                                onChange={(event) => setting({ targetColor: event.target.value })}
                              />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                    <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          className="accent-violet-600"
                          checked={draft.background}
                          onChange={(event) => setting({ background: event.target.checked })}
                        />
                        更换背景
                      </label>
                      {draft.background && (
                        <>
                          <label className="mt-3 block text-sm">
                            想换成什么背景？
                            <textarea
                              className={field}
                              value={draft.backgroundDescription ?? ''}
                              maxLength={1000}
                              rows={2}
                              placeholder="例如：明亮的户外花园，保留人物和产品"
                              onChange={(event) =>
                                setting({ backgroundDescription: event.target.value })
                              }
                            />
                          </label>
                          {imageField('上传背景参考图（可选）', 'backgroundAssetId')}
                        </>
                      )}
                    </div>
                    <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          className="accent-violet-600"
                          checked={draft.face}
                          onChange={(event) => setting({ face: event.target.checked })}
                        />
                        更换人物脸部
                      </label>
                      {draft.face && (
                        <>
                          <label className="mt-3 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={draft.facePresence === 'present'}
                              onChange={(event) =>
                                setting({
                                  facePresence: event.target.checked ? 'present' : 'unknown',
                                })
                              }
                            />
                            我确认这一段有清楚露脸
                          </label>
                          {imageField('上传目标人脸图片', 'faceAssetId')}
                        </>
                      )}
                    </div>
                  </fieldset>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      className={secondary}
                      disabled={
                        busy ||
                        ambiguousJob ||
                        active(segment) ||
                        !!uncertain ||
                        !dirty ||
                        !valid(draft)
                      }
                      onClick={() =>
                        void perform(async (signal) => {
                          await patch({ remake: draft, useOriginal: false }, signal);
                        })
                      }
                    >
                      保存修改设置
                    </button>
                    <button
                      className={primary}
                      disabled={
                        busy ||
                        ambiguousJob ||
                        !generationReady ||
                        active(segment) ||
                        !!uncertain ||
                        !valid(draft) ||
                        (!!segment.clientRequestId && !segment.jobId)
                      }
                      onClick={() => generate(false)}
                    >
                      {segment.jobId ? '生成新版本' : '生成这一段'}
                      <ChevronRight size={16} />
                    </button>
                    <button
                      className={secondary}
                      disabled={busy || active(segment) || !!uncertain}
                      onClick={() =>
                        void perform(async (signal) => {
                          await patch({ useOriginal: true, approved: true }, signal);
                        })
                      }
                    >
                      这一段保持原样
                    </button>
                    {dirty && (
                      <span className="text-xs text-amber-600">设置有改动，生成后重新审核</span>
                    )}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    生成会产生费用。建议先试一段，满意后再做下一段。
                    {!generationReady && ' 当前生成服务尚未配置，请联系管理员。'}
                  </p>
                </section>
                <section
                  className={`${panel} flex flex-wrap items-center justify-between gap-4 p-5`}
                >
                  <div>
                    <h2 className="font-semibold">全部满意，再合成</h2>
                    <p className="mt-2 text-xs text-slate-500">
                      已确认 {approved}/{project.segments.length} 段 · 按原顺序拼接，保留原片声音
                    </p>
                  </div>
                  <button
                    className={primary}
                    disabled={
                      busy ||
                      dirty ||
                      approved !== project.segments.length ||
                      !project.segments.length
                    }
                    onClick={() =>
                      void perform(async (signal) => {
                        const next = await request<VideoProject>(
                          `/projects/${project.id}/assemble`,
                          {},
                          'POST',
                          signal
                        );
                        if (!signal.aborted) remember(next);
                      })
                    }
                  >
                    合成完整视频
                    <ChevronRight size={16} />
                  </button>
                </section>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
