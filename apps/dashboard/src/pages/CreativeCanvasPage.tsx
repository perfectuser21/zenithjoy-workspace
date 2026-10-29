import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

type CanvasStatus = 'checking' | 'available' | 'unavailable';

export default function CreativeCanvasPage() {
  const [status, setStatus] = useState<CanvasStatus>('checking');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setStatus('checking'); setAttempt(value => value + 1); }, []);

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
          <a href="/api/creative-canvas/extensions/zenithjoy/image2-select-wan.json" download="图片转视频工作流.json" className="rounded-lg border border-violet-300 px-3 py-1.5 text-violet-700 hover:bg-violet-50 dark:text-violet-300">下载图片转视频工作流</a>
          <a href="/api/creative-canvas/extensions/zenithjoy/upload-image-wan.json" download="上传图片工作流.json" className="rounded-lg border border-violet-300 px-3 py-1.5 text-violet-700 hover:bg-violet-50 dark:text-violet-300">下载上传图片工作流</a>
          <span>下载后，将文件拖入画布即可开始。</span>
        </div>
        <iframe title="视频创作画布" src="/api/creative-canvas/" className="min-h-[70vh] w-full flex-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700" allow="clipboard-read; clipboard-write" />
      </>}
    </div>
  );
}
