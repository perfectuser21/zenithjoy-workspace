export interface WorkflowAsset {
  id: string;
  url: string;
  kind: 'image' | 'video';
  name: string;
  width: number;
  height: number;
  duration: number;
}
export interface WorkflowRemake {
  referenceAssetId: string;
  productMode: 'keep' | 'replace' | 'color' | 'logo';
  productAssetId?: string;
  productDescription?: string;
  targetColor?: string;
  background: boolean;
  backgroundDescription?: string;
  backgroundAssetId?: string;
  face: boolean;
  facePresence: 'unknown' | 'absent' | 'present';
  faceAssetId?: string;
}
export interface WorkflowJob {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown';
  videoUrl?: string;
  error?: string;
}
export interface WorkflowSegment {
  id: string;
  revision?: number;
  start: number;
  end: number;
  assetId: string;
  videoUrl: string;
  remake?: WorkflowRemake;
  clientRequestId?: string;
  jobId?: string;
  job?: WorkflowJob;
  approved: boolean;
  useOriginal: boolean;
}
export interface VideoProject {
  id: string;
  name: string;
  sourceAssetId: string;
  source: WorkflowAsset;
  confirmed: boolean;
  status: 'splitting' | 'review' | 'editing' | 'assembling' | 'completed' | 'failed';
  segments: WorkflowSegment[];
  outputUrl?: string;
  error?: string;
}
export const VIDEO_WORKFLOW_BASE = '/api/video-tools';
export async function videoWorkflowRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 45_000);
  try {
    const response = await fetch(`${VIDEO_WORKFLOW_BASE}${path}`, {
      method,
      credentials: 'include',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(
        new Error(
          typeof result.error === 'string'
            ? result.error
            : response.status === 401
              ? '登录已失效，请重新登录'
              : '操作未完成，请稍后重试'
        ),
        { status: response.status }
      );
    return result as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
export async function uploadWorkflowAsset(
  file: File,
  onProgress: (progress: string) => void,
  signal: AbortSignal
): Promise<WorkflowAsset> {
  const image = /\.(png|jpe?g|webp)$/i.test(file.name);
  const video = /\.(mp4|mov|webm)$/i.test(file.name);
  if ((!image && !video) || !file.size || file.size > (image ? 20 : 100) * 1024 * 1024)
    throw new Error('请选择有效的视频（最多 100 MB）或图片（最多 20 MB）');
  onProgress('正在准备上传…');
  const intent = await videoWorkflowRequest<{ id: string; uploadUrl: string }>(
    '/uploads/presign',
    { name: file.name, size: file.size },
    'POST',
    signal
  );
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(`正在上传 ${Math.round((event.loaded / event.total) * 100)}%`);
    };
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300
          ? undefined
          : new Error(`素材上传失败（HTTP ${xhr.status}），请重试`)
      );
    xhr.onerror = () => finish(new Error('上传连接中断，请检查网络后重试'));
    xhr.ontimeout = () => finish(new Error('上传超时，请重新选择文件'));
    xhr.onabort = () => finish(new DOMException('上传已取消', 'AbortError'));
    if (signal.aborted) {
      finish(new DOMException('上传已取消', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('PUT', intent.uploadUrl);
    xhr.timeout = 10 * 60 * 1000;
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
  onProgress('正在检查素材…');
  return videoWorkflowRequest<WorkflowAsset>(
    `/uploads/${encodeURIComponent(intent.id)}/complete`,
    {},
    'POST',
    signal
  );
}
