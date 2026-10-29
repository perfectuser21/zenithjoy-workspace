import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

type CanvasStatus = 'checking' | 'available' | 'unavailable';

export default function CreativeCanvasPage() {
  const [status, setStatus] = useState<CanvasStatus>('checking');
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [opening, setOpening] = useState(false);
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'slow'>('loading');
  const [workflowError, setWorkflowError] = useState('');
  const openWorkflow = useCallback(async (kind: 'upload' | 'generate') => {
    setWorkflowError(''); setOpening(true);
    try {
      const frame = frameRef.current;
      const child = frame?.contentWindow;
      if (!frame || frame.getAttribute('src') !== '/api/creative-canvas/' || !child || child.location.origin !== window.location.origin) throw new Error('画布尚未准备好');
      const app = (child as Window & { app?: { loadGraphData?: (graph: unknown, clear: boolean, restoreView: boolean, name: string) => Promise<unknown> } }).app;
      if (typeof app?.loadGraphData !== 'function') throw new Error('画布尚未准备好');
      const name = kind === 'upload' ? '上传图片工作流' : '图片生成工作流';
      const filename = kind === 'upload' ? 'upload-image-wan.json' : 'image2-select-wan.json';
      const response = await fetch(`/api/creative-canvas/extensions/zenithjoy/${filename}`, {credentials:'include'});
      if (!response.ok) throw new Error('模板暂时不可用');
      const graph: unknown = await response.json();
      if (!graph || typeof graph !== 'object' || !Array.isArray((graph as {nodes?: unknown}).nodes) || !Array.isArray((graph as {links?: unknown}).links)) throw new Error('模板格式无效');
      if (frameRef.current !== frame || frame.contentWindow !== child || child.location.origin !== window.location.origin || (child as Window & {app?: unknown}).app !== app) throw new Error('画布已重新加载');
      const random = new Uint8Array(8); window.crypto.getRandomValues(random);
      const suffix = Array.from(random, value => value.toString(16).padStart(2, '0')).join('');
      const opened = await app.loadGraphData(graph,true,true,`${name}-${suffix}`);
      if (opened === false) throw new Error('画布未能加载模板');
    } catch {
      setWorkflowError('工作流打开失败，请稍后重试。当前画布仍可使用。');
    } finally { setOpening(false); }
  }, []);
  const retry = useCallback(() => { setStatus('checking'); setAttempt(value => value + 1); }, []);

  useEffect(() => {
    if (status !== 'available') return;
    setFrameState('loading');
    const started = Date.now();
    const check = () => {
      try {
        const frame = frameRef.current;
        const child = frame?.contentWindow as (Window & {app?: {graph?: unknown; loadGraphData?: unknown}}) | null;
        if (child?.location.origin === window.location.origin && child.app?.graph && typeof child.app.loadGraphData === 'function' && !frame?.contentDocument?.getElementById('splash-loader')) {
          setFrameState('ready');
          return;
        }
      } catch { /* Frame may be navigating; wait for its same-origin document. */ }
      setFrameState(Date.now() - started >= 120000 ? 'slow' : 'loading');
    };
    const timer = window.setInterval(check, 500);
    check();
    return () => window.clearInterval(timer);
  }, [status, attempt]);

  useEffect(() => {
    // Dropping a file on the surrounding dashboard otherwise navigates away
    // from the editor. Drops inside the iframe remain handled by ComfyUI.
    const preventFileNavigation = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    fetch('/api/creative-canvas/status', { credentials: 'include', signal: controller.signal })
      .then(async response => response.ok && (await response.json()).available === true)
      .then(available => { if (mounted) setStatus(available ? 'available' : 'unavailable'); })
      .catch(() => { if (mounted) setStatus('unavailable'); });
    return () => { mounted = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-4">
      <div>
        <Link to="/area/video-tools" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600"><ArrowLeft size={16} />视频工具</Link>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">视频创作画布</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">连接素材和创作步骤，预览结果后继续下一步。</p>
      </div>
      {status === 'checking' && <p role="status" className="text-sm text-slate-500">正在连接画布…</p>}
      {status === 'unavailable' && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p>创作画布暂时不可用，请联系管理员。</p>
        <button type="button" onClick={retry} className="mt-3 rounded-lg border border-amber-500 px-3 py-1.5">重新连接</button>
      </div>}
      {status === 'available' && <>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <button type="button" disabled={opening || frameState !== 'ready'} onClick={() => void openWorkflow('upload')} className="rounded-lg border border-violet-300 px-3 py-1.5 text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300">打开上传图片工作流</button>
          <button type="button" disabled={opening || frameState !== 'ready'} onClick={() => void openWorkflow('generate')} className="rounded-lg border border-violet-300 px-3 py-1.5 text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300">打开图片生成工作流</button>
          {frameState === 'loading' && <span role="status">画布正在加载，请稍候…</span>}
          {frameState === 'slow' && <span role="alert">画布加载时间过长，请重新连接或联系管理员。</span>}
          {frameState === 'slow' && <button type="button" onClick={retry} className="rounded-lg border border-amber-500 px-3 py-1.5">重新连接</button>}
          {opening && <span role="status">正在打开工作流…</span>}
          {workflowError && <span role="alert">{workflowError}</span>}
        </div>
        <iframe ref={frameRef} title="视频创作画布" src="/api/creative-canvas/" className="min-h-[70vh] w-full flex-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700" allow="clipboard-read; clipboard-write" />
      </>}
    </div>
  );
}
