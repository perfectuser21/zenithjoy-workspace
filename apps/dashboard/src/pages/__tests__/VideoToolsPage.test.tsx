import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  authState.user = { id: 'staff-a' };
  submitted = undefined;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/config')) return response(config);
    if (url.endsWith('/uploads')) return response({ id: 'upload-1', url: 'https://storage.example/input.mp4', kind: 'video', name: 'input.mp4' });
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
});
