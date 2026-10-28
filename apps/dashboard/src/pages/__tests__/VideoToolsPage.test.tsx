import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WanPlaygroundPage from '../WanPlaygroundPage';
import VideoUpscalePage from '../VideoUpscalePage';
import AreaHubPage from '../AreaHubPage';

const authState = vi.hoisted(() => ({ user: { id: 'staff-a' } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authState }));

const config = { wan: { configured: true, missing: [] }, upscale: { configured: true, missing: [] }, uploads: { configured: true } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
let submitted: Record<string, unknown> | undefined;
let xhrs: UploadRequest[] = [];
let automaticallyFinishUpload = true;
class UploadRequest {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  timeout = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: Document | XMLHttpRequestBodyInit | null | undefined;
  aborted = false;
  constructor() { xhrs.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sent = body;
    if (automaticallyFinishUpload) queueMicrotask(() => this.finish());
  }
  abort() { this.aborted = true; this.onabort?.(); }
  progress(loaded: number, total: number) { this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent); }
  finish(status = 200, body = '') { this.status = status; this.responseText = body; this.onload?.(); }
}

beforeEach(() => {
  authState.user = { id: 'staff-a' };
  xhrs = [];
  automaticallyFinishUpload = true;
  vi.stubGlobal('XMLHttpRequest', UploadRequest);
  submitted = undefined;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/config')) return response(config);
    if (url.endsWith('/uploads/presign')) return response({ id: 'upload-1', uploadUrl: 'https://private.cos.example/upload-1?q-signature=must-not-leak' });
    if (url.endsWith('/uploads/upload-1/complete')) return response({ id: 'upload-1', url: 'https://storage.example/input.mp4', kind: 'video', name: 'input.mp4' });
    if (url.endsWith('/jobs') && init?.method === 'POST') {
      submitted = JSON.parse(String(init.body));
      return response({ id: 'job-1', kind: submitted?.kind, status: 'pending', createdAt: '2026-10-28T00:00:00Z' }, 202);
    }
    if (url.endsWith('/jobs/job-1')) return response({ id: 'job-1', kind: submitted?.kind, status: 'succeeded', videoUrl: 'https://storage.example/result.mp4', createdAt: '2026-10-28T00:00:00Z' });
    if (url.endsWith('/jobs')) return response({ jobs: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('员工视频工具', () => {
  it('Wan 提交提示词及参数，查询真实任务成功后显示预览和下载', async () => {
    render(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('视频描述'), { target: { value: '一只猫在海边散步' } });
    const submit = await screen.findByRole('button', { name: '生成视频' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await screen.findByRole('link', { name: '下载视频' });
    expect(submitted).toMatchObject({ kind: 'wan', prompt: '一只猫在海边散步', resolution: '720P', duration: 5, audio: true });
    expect(screen.getByTestId('video-result')).toHaveAttribute('src', 'https://storage.example/result.mp4');
    expect(screen.getByRole('link', { name: '下载视频' })).toHaveAttribute('href', '/api/video-tools/jobs/job-1/download?download=1');
    expect(fetchMock.mock.calls.every(([, options]) => options?.credentials === 'include')).toBe(true);
  });

  it('生成失败显示原因且不把原素材当作成功视频', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith('/jobs/job-1')
      ? response({ id: 'job-1', kind: 'wan', status: 'failed', error: '素材无法处理，请更换素材', createdAt: '2026-10-28T00:00:00Z' })
      : original(url, init));
    render(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('视频描述'), { target: { value: '生成测试视频' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '生成视频' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }));
    await screen.findByText('素材无法处理，请更换素材');
    expect(screen.queryByTestId('video-result')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '下载视频' })).not.toBeInTheDocument();
  });

  it('超分独立上传视频并提交超分任务，不要求 Wan 提示词', async () => {
    render(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('上传待超分视频'), { target: { files: [new File(['video'], 'input.mp4', { type: 'video/mp4' })] } });
    await screen.findByText('input.mp4');
    const submit = screen.getByRole('button', { name: '开始超分' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await screen.findByRole('link', { name: '下载视频' });
    expect(submitted).toMatchObject({ kind: 'upscale', videoUrl: 'https://storage.example/input.mp4', bitRate: 10, clientRequestId: expect.any(String) });
    expect(screen.queryByLabelText('视频描述')).not.toBeInTheDocument();
  });

  it('服务未配置时禁用付费提交，并明确提示联系管理员', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith('/config')
      ? response({ ...config, wan: { configured: false, missing: ['DASHSCOPE_API_KEY'] } })
      : original(url, init));
    render(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    await screen.findByText('服务尚未配置，请联系管理员');
    fireEvent.change(screen.getByLabelText('视频描述'), { target: { value: '测试' } });
    expect(screen.getByRole('button', { name: '生成视频' })).toBeDisabled();
    expect(screen.queryByText('DASHSCOPE_API_KEY')).not.toBeInTheDocument();
  });

  it('员工工具入口可以发现两个独立工具', () => {
    render(<MemoryRouter initialEntries={['/area/video-tools']}><AreaHubPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Wan Playground/ })).toHaveAttribute('href', '/wan-playground');
    expect(screen.getByRole('link', { name: /视频超分/ })).toHaveAttribute('href', '/video-upscale');
  });

  it('提交响应丢失后再次提交沿用同一幂等键，避免重复计费', async () => {
    const original = fetchMock.getMockImplementation()!;
    const attempts: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/jobs') && init?.method === 'POST') {
        attempts.push(JSON.parse(String(init.body)));
        if (attempts.length === 1) throw new Error('网络连接中断，请重试');
      }
      return original(url, init);
    });
    render(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('视频描述'), { target: { value: '海边散步' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '生成视频' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }));
    await screen.findByText('网络连接中断，请重试');
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }));
    await screen.findByRole('link', { name: '下载视频' });
    expect(attempts).toHaveLength(2);
    expect(attempts[0].clientRequestId).toEqual(expect.any(String));
    expect(attempts[1].clientRequestId).toBe(attempts[0].clientRequestId);
  });

  it('同页切换员工账号时清除上一个账号的素材、提示词与成片', async () => {
    const view = render(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('视频描述'), { target: { value: '员工 A 的描述' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '生成视频' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }));
    await screen.findByRole('link', { name: '下载视频' });
    authState.user = { id: 'staff-b' };
    view.rerender(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    expect(screen.getByLabelText('视频描述')).toHaveValue('');
    expect(screen.queryByTestId('video-result')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '下载视频' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/config'))).toHaveLength(2));
  });

  it('视频直接 PUT 对象存储，显示上传进度，完成检查后才显示可用素材', async () => {
    automaticallyFinishUpload = false;
    const original = fetchMock.getMockImplementation()!;
    let finishCheck: (value: Response) => void = () => {};
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/uploads/upload-1/complete')
      ? new Promise<Response>(resolve => { finishCheck = resolve; }) : original(url, init));
    render(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled());
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'input.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('上传待超分视频'), { target: { files: [file] } });
    await waitFor(() => expect(xhrs[0]?.sent).toBe(file));
    expect(xhrs[0].method).toBe('PUT');
    expect(xhrs[0].url).toBe('https://private.cos.example/upload-1?q-signature=must-not-leak');
    expect(xhrs[0].withCredentials).toBe(false);
    expect(xhrs[0].headers.Authorization).toBeUndefined();
    expect(xhrs[0].timeout).toBeGreaterThan(0);
    expect(xhrs[0].timeout).toBeLessThanOrEqual(600_000);
    const presign = fetchMock.mock.calls.find(([url]) => url.endsWith('/uploads/presign'))!;
    expect(JSON.parse(String(presign[1]?.body))).toEqual({ name: 'input.mp4', size: 2 * 1024 * 1024 });
    act(() => xhrs[0].progress(1024 * 1024, 2 * 1024 * 1024));
    expect(screen.getByRole('progressbar', { name: '上传进度' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/50%.*1\.0.*2\.0 MB/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false);
    act(() => xhrs[0].finish());
    await screen.findByText('上传完毕，正在检查视频');
    expect(screen.getByRole('button', { name: '开始超分' })).toBeDisabled();
    await act(async () => finishCheck(response({ id: 'upload-1', url: 'https://storage.example/input.mp4', kind: 'video', name: 'input.mp4' })));
    await screen.findByText('input.mp4');
    await waitFor(() => expect(screen.getByRole('button', { name: '开始超分' })).not.toBeDisabled());
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/video-tools/uploads')).toBe(false);
  });

  it('对象存储返回403时显示HTTP和COS错误码，不确认素材、不自动重传、不泄漏签名', async () => {
    automaticallyFinishUpload = false;
    render(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('上传待超分视频'), { target: { files: [new File(['video'], 'input.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(xhrs).toHaveLength(1));
    act(() => xhrs[0].finish(403, '<Error><Code>AccessDenied</Code><Message>https://private.cos.example/?q-signature=must-not-leak</Message></Error>'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP 403.*AccessDenied/);
    expect(screen.getByRole('alert')).not.toHaveTextContent('must-not-leak');
    expect(screen.getByRole('button', { name: '开始超分' })).toBeDisabled();
    expect(screen.queryByText('input.mp4')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false);
    expect(xhrs).toHaveLength(1);
  });

  it('上传过程中切换账号中止对象存储请求，不向新账号确认旧素材', async () => {
    automaticallyFinishUpload = false;
    const view = render(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('上传待超分视频'), { target: { files: [new File(['video'], 'input.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(xhrs).toHaveLength(1));
    authState.user = { id: 'staff-b' };
    view.rerender(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    expect(xhrs[0].aborted).toBe(true);
    act(() => xhrs[0].finish());
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false);
    expect(screen.queryByText('input.mp4')).not.toBeInTheDocument();
  });

  it('对象存储上传超时后不重传大文件，清楚提示超时并允许重新选择', async () => {
    automaticallyFinishUpload = false;
    render(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('上传待超分视频'), { target: { files: [new File(['video'], 'input.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(xhrs).toHaveLength(1));
    act(() => xhrs[0].ontimeout?.());
    expect(await screen.findByRole('alert')).toHaveTextContent('上传超时');
    expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '开始超分' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/uploads/presign'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(false);
    expect(xhrs).toHaveLength(1);
  });

  it('完成检查失败显示具体HTTP码，不把未通过检查的文件当作可用素材', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/uploads/upload-1/complete')
      ? response({ error: '视频无法读取，请换一个文件' }, 422) : original(url, init));
    render(<MemoryRouter><VideoUpscalePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传待超分视频')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('上传待超分视频'), { target: { files: [new File(['video'], 'input.mp4', { type: 'video/mp4' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('视频无法读取，请换一个文件（HTTP 422）');
    expect(screen.getByRole('button', { name: '开始超分' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '移除 input.mp4' })).not.toBeInTheDocument();
    expect(xhrs).toHaveLength(1);
  });

  it('批量参考素材逐个直传，后续文件失败仍保留已检查成功的素材', async () => {
    automaticallyFinishUpload = false;
    const original = fetchMock.getMockImplementation()!;
    let signedCount = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/uploads/presign')) { signedCount++; return response({ id: `image-${signedCount}`, uploadUrl: `https://private.cos.example/image-${signedCount}` }); }
      if (url.endsWith('/uploads/image-1/complete')) return response({ id: 'image-1', url: 'https://storage.example/first.png', kind: 'image', name: 'first.png' });
      return original(url, init);
    });
    render(<MemoryRouter><WanPlaygroundPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('上传参考素材')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('上传参考素材'), { target: { files: [new File(['image-one'], 'first.png', { type: 'image/png' }), new File(['image-two'], 'second.png', { type: 'image/png' })] } });
    await waitFor(() => expect(xhrs).toHaveLength(1));
    expect(signedCount).toBe(1);
    act(() => xhrs[0].finish());
    await screen.findByRole('button', { name: '移除 first.png' });
    await waitFor(() => expect(xhrs).toHaveLength(2));
    act(() => xhrs[1].finish(500));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500');
    expect(screen.getByRole('button', { name: '移除 first.png' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除 second.png' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/complete'))).toHaveLength(1);
  });
});
