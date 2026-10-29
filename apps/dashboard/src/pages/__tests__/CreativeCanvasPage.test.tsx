import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CreativeCanvasPage from '../CreativeCanvasPage';
import AreaHubPage from '../AreaHubPage';
import { additionalRoutes } from '../../config/navigation.config';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('创作画布', () => {
  it('图片拖到画布外时阻止浏览器打开文件并离开页面', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: true }), { status: 200 })));
    render(<MemoryRouter><CreativeCanvasPage /></MemoryRouter>);
    await screen.findByTitle('视频创作画布');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTitle('视频创作画布')).toBeInTheDocument();
  });
  it('服务可用时加载站内画布', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><CreativeCanvasPage /></MemoryRouter>);
    expect(await screen.findByTitle('视频创作画布')).toHaveAttribute('src', '/api/creative-canvas/');
    expect(screen.getByRole('button', {name:'打开上传图片工作流'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name:'打开图片生成工作流'})).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/creative-canvas/status', expect.objectContaining({ credentials: 'include' }));
  });
  it('在画布新建标签打开上传图片模板，保留当前工作流', async () => {
    const graph = {nodes:[{type:'LoadImage'}],links:[]};
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({available:true}),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify(graph),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    render(<MemoryRouter><CreativeCanvasPage /></MemoryRouter>);
    const iframe = await screen.findByTitle('视频创作画布') as HTMLIFrameElement;
    const loadGraphData = vi.fn().mockResolvedValue({});
    Object.defineProperty(iframe.contentWindow!, 'app', {value:{loadGraphData}, configurable:true});
    fireEvent.click(screen.getByRole('button',{name:'打开上传图片工作流'}));
    await vi.waitFor(()=>expect(loadGraphData).toHaveBeenCalled());
    expect(loadGraphData).toHaveBeenCalledWith(graph,true,true,expect.stringMatching(/^上传图片工作流/));
    expect(fetchMock).toHaveBeenCalledWith('/api/creative-canvas/extensions/zenithjoy/upload-image-wan.json',expect.objectContaining({credentials:'include'}));
  });
  it('画布未准备好时显示可重试提示', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({available:true}),{status:200})));
    render(<MemoryRouter><CreativeCanvasPage /></MemoryRouter>);
    await screen.findByTitle('视频创作画布');
    fireEvent.click(screen.getByRole('button',{name:'打开上传图片工作流'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('工作流打开失败');
  });
  it('未配置或服务不可用时显示提示而不是空白画布', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false }), { status: 200 })));
    render(<MemoryRouter><CreativeCanvasPage /></MemoryRouter>);
    expect(await screen.findByText('创作画布暂时不可用，请联系管理员。')).toBeInTheDocument();
    expect(screen.queryByTitle('视频创作画布')).not.toBeInTheDocument();
  });
  it('网络失败时提示并可重试', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><CreativeCanvasPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '重新连接' }));
    expect(await screen.findByTitle('视频创作画布')).toHaveAttribute('src', '/api/creative-canvas/');
  });
  it('视频工具页有画布入口，路由要求员工身份', () => {
    render(<MemoryRouter initialEntries={['/area/video-tools']}><AreaHubPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /视频创作画布/ })).toHaveAttribute('href', '/creative-canvas');
    expect(additionalRoutes.find(r => r.path === '/creative-canvas')).toMatchObject({ requireAuth: true, requireStaff: true });
  });
});
