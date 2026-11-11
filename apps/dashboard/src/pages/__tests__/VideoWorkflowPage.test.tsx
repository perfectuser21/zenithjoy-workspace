import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VideoWorkflowPage from '../VideoWorkflowPage';

const source = { id: 'source-1', kind: 'video', name: '一分钟原片.mp4', url: 'https://media.example/source.mp4', width: 720, height: 1280, duration: 60 };
const segment = { id: 'segment-1', start: 0, end: 12, assetId: 'clip-1', videoUrl: 'https://media.example/clip.mp4', approved: false, useOriginal: false };
function project(overrides: Record<string, unknown> = {}) { return { id: 'project-1', name: '一分钟原片', sourceAssetId: source.id, source, status: 'review', confirmed: false, segments: [segment], ...overrides }; }
function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function mockApi(current = project()) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/config')) return reply({ wan: { configured: true }, uploads: { configured: true } });
    if (url.endsWith('/projects') && !init?.method) return reply({ projects: [current] });
    if (url.endsWith('/projects/project-1') && init?.method === 'PATCH') return reply({ ...current, confirmed: true, status: 'editing' });
    if (url.endsWith('/projects/project-1')) return reply(current);
    return reply({ error: '测试未定义接口' }, 500);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
function open(path = '/creative-canvas?project=project-1') { return render(<MemoryRouter initialEntries={[path]}><VideoWorkflowPage /></MemoryRouter>); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('简单视频制作流程', () => {
  it('先呈现业务步骤与上传入口，默认不加载底层画布', async () => {
    mockApi(); open('/creative-canvas');
    expect(screen.getByRole('heading', { name: '把整条视频，一步步改好' })).toBeInTheDocument();
    expect(screen.getByLabelText('上传完整视频')).toBeInTheDocument();
    expect(screen.queryByTitle('视频创作画布')).not.toBeInTheDocument();
    expect(screen.queryByText(/采样器|种子值|步数/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /一分钟原片/ })).toBeInTheDocument();
  });
  it('分镜确认前只允许查看调整，确认后才能设置修改', async () => {
    const api = mockApi(); open();
    expect(await screen.findByRole('button', { name: '确认分段，下一步' })).toBeEnabled();
    expect(screen.getByLabelText('片段 1 原片')).toHaveAttribute('src', segment.videoUrl);
    expect(screen.queryByRole('button', { name: '生成这一段' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认分段，下一步' }));
    expect(await screen.findByRole('heading', { name: '这一段怎么改？' })).toBeInTheDocument();
    expect(api.mock.calls.some(([url, init]) => url.endsWith('/jobs') && init?.method === 'POST')).toBe(false);
  });
  it('保存生成请求标识后提交，网络失败重试沿用同一标识', async () => {
    let current = project({ confirmed: true, status: 'editing', segments: [{ ...segment, remake: { referenceAssetId: 'clip-1', productMode: 'keep', background: true, backgroundDescription: '明亮的摄影棚', face: false, facePresence: 'unknown' } }] });
    const submitted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/config')) return reply({ wan: { configured: true }, uploads: { configured: true } });
      if (url.endsWith('/projects')) return reply({ projects: [current] });
      if (url.includes('/segments/') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        current = { ...current, segments: [{ ...current.segments[0], ...body }] };
        return reply(current);
      }
      if (url.endsWith('/jobs') && init?.method === 'POST') { submitted.push(JSON.parse(String(init.body)).clientRequestId); throw new TypeError('网络连接中断'); }
      return reply(current);
    }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: '生成这一段' }));
    expect(await screen.findByText(/提交结果尚未确认/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查询本次提交' }));
    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted[1]).toBe(submitted[0]);
  });
  it('生成成功仍需人工审核，未审核不能合成', async () => {
    mockApi(project({ confirmed: true, status: 'editing', segments: [{ ...segment, jobId: 'job-1', job: { id: 'job-1', status: 'succeeded', videoUrl: 'https://media.example/result.mp4' } }] }));
    open();
    expect(await screen.findByRole('button', { name: '这一段满意，确认使用' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '合成完整视频' })).toBeDisabled();
    expect(screen.getByLabelText('片段 1 修改结果')).toHaveAttribute('src', 'https://media.example/result.mp4');
  });
  it('所有片段审核后允许合成，导出时保留原声', async () => {
    const api = mockApi(project({ confirmed: true, status: 'editing', segments: [{ ...segment, approved: true, useOriginal: true }] }));
    api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/config')) return reply({ wan: { configured: true }, uploads: { configured: true } });
      if (url.endsWith('/assemble')) return reply(project({ status: 'assembling', confirmed: true }));
      if (url.endsWith('/projects')) return reply({ projects: [] });
      return reply(project({ confirmed: true, status: 'editing', segments: [{ ...segment, approved: true, useOriginal: true }] }));
    });
    open();
    fireEvent.click(await screen.findByRole('button', { name: '合成完整视频' }));
    await waitFor(() => expect(api.mock.calls.some(([url, init]) => url.endsWith('/assemble') && init?.method === 'POST')).toBe(true));
    expect(await screen.findByText('正在合成成片')).toBeInTheDocument();
  });
  it('项目读取失败提供重试，不把失败当成空项目', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: '项目暂时无法读取' }, 503)));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('项目暂时无法读取');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});
