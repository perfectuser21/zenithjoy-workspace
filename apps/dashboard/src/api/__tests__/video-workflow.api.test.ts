import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadWorkflowAsset, videoWorkflowRequest } from '../video-workflow.api';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('视频制作请求边界', () => {
  it('带当前会话发送JSON并读回服务端项目，保留分段版本', async () => {
    const expected = { id: 'project-1', segments: [{ id: 'segment-1', revision: 4 }] };
    let received: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      received = { url, init };
      return response(expected);
    });
    const result = await videoWorkflowRequest(
      '/projects/project-1/segments/segment-1',
      { expectedRevision: 3, approved: true },
      'PATCH'
    );
    expect(result).toEqual(expected);
    expect(received?.url).toBe('/api/video-tools/projects/project-1/segments/segment-1');
    expect(received?.init).toMatchObject({
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(received?.init?.body))).toEqual({
      expectedRevision: 3,
      approved: true,
    });
  });

  it('登录过期返回可识别的401错误，不把错误内容当项目', async () => {
    vi.stubGlobal('fetch', async () => response({}, 401));
    await expect(videoWorkflowRequest('/projects')).rejects.toMatchObject({
      status: 401,
      message: '登录已失效，请重新登录',
    });
  });

  it.each(['调用方取消', '请求超时'] as const)('%s会中断底层连接并清理计时器', async (kind) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let innerSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          innerSignal = init?.signal as AbortSignal;
          innerSignal.addEventListener(
            'abort',
            () => reject(new DOMException('已取消', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = videoWorkflowRequest('/projects', undefined, 'GET', caller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    if (kind === '调用方取消') caller.abort();
    else await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(innerSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('图片超过20MB或视频超过100MB时在上传前拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const [name, size] of [
      ['人脸.png', 20 * 1024 * 1024 + 1],
      ['整片.mp4', 100 * 1024 * 1024 + 1],
    ] as const) {
      const file = new File(['content'], name);
      Object.defineProperty(file, 'size', { value: size });
      await expect(
        uploadWorkflowAsset(file, () => {}, new AbortController().signal)
      ).rejects.toThrow('请选择有效的视频');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('直传存储返回失败时不会确认素材或创建后续视频任务', async () => {
    class FailedUpload {
      status = 403;
      upload = {};
      onload: (() => void) | null = null;
      onerror = null;
      ontimeout = null;
      onabort = null;
      open() {}
      setRequestHeader() {}
      abort() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FailedUpload);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return response({ id: 'upload-1', uploadUrl: 'https://storage.example/put' });
    });
    await expect(
      uploadWorkflowAsset(
        new File(['video'], '整片.mp4', { type: 'video/mp4' }),
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow('HTTP 403');
    expect(calls).toEqual(['/api/video-tools/uploads/presign']);
  });
});
