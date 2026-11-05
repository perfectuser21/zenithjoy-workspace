import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AcquisitionTasksPage from './AcquisitionTasksPage';

function mockFetchByUrl(handlers: Record<string, unknown>) {
  return vi.fn((url: string, _init?: RequestInit) => {
    for (const [pattern, body] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
      }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: {} }) } as Response);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe('AcquisitionTasksPage — 旧版采集退役', () => {
  it('展示退役说明和历史任务，不提供新采集入口', async () => {
    const fetchMock = mockFetchByUrl({
      '/api/agent/machines': { success: true, data: [] },
      '/api/agent/burner/sessions': { success: true, data: { sessions: [] } },
      '/api/acquisition/collect-tasks': { success: true, data: { tasks: [{ id: 'old-1', keywords: ['历史关键词'], status: 'done', video_count: 2, lead_count_raw: 1, created_at: null, cancel_phase: null, cooldown_remaining_seconds: 0 }] } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);
    expect(await screen.findByText('历史关键词')).toBeTruthy();
    expect(screen.getByText(/旧版获客已停用/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /开始采集/ })).toBeNull();
    expect(screen.getByText('查看详情').getAttribute('href')).toBe('/area/acquisition/tasks/old-1');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/collect/start'))).toBe(false);
  });

  it('保留运行中旧任务的取消入口', async () => {
    const fetchMock = mockFetchByUrl({
      '/api/agent/machines': { success: true, data: [] },
      '/api/agent/burner/sessions': { success: true, data: { sessions: [] } },
      '/api/acquisition/collect/cancel': { success: true },
      '/api/acquisition/collect-tasks': { success: true, data: { tasks: [{ id: 'old-running', keywords: ['待取消'], status: 'running', video_count: 0, lead_count_raw: 0, created_at: null, cancel_phase: null, cooldown_remaining_seconds: 0 }] } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '放弃' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/collect/cancel') && JSON.parse((c[1] as RequestInit).body as string).task_id === 'old-running')).toBe(true));
  });
});

// regression(2026-07-04): 任务详情页空状态提示必须按任务真实状态区分，不能无条件说"采集中"
describe('AcquisitionTasksPage — 任务详情空状态按真实状态区分 [REGRESSION]', () => {
  function renderTaskDetail(taskId: string) {
    return render(
      <MemoryRouter initialEntries={[`/area/acquisition/tasks/${taskId}`]}>
        <Routes>
          <Route path="/area/acquisition/tasks/:taskId" element={<AcquisitionTasksPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('任务 status=failed → 显示失败原因，不显示"采集中"', async () => {
    global.fetch = mockFetchByUrl({
      '/api/acquisition/collect-tasks/task-failed/videos': {
        success: true,
        data: { videos: [], total: 0, task: { status: 'failed', error_code: 'NO_VIDEOS_FOUND', video_count: 0 } },
      },
    }) as unknown as typeof fetch;

    renderTaskDetail('task-failed');

    await waitFor(() => {
      expect(screen.getByText(/采集失败.*没有搜到相关视频/)).toBeTruthy();
    });
    expect(screen.queryByText('采集中，稍后刷新查看视频结果')).toBeNull();
  });

  it('任务终态(stage_1_done)但无视频记录 → 显示"未抓到任何视频"，不显示"采集中"', async () => {
    global.fetch = mockFetchByUrl({
      '/api/acquisition/collect-tasks/task-done-empty/videos': {
        success: true,
        data: { videos: [], total: 0, task: { status: 'stage_1_done', error_code: null, video_count: 2 } },
      },
    }) as unknown as typeof fetch;

    renderTaskDetail('task-done-empty');

    await waitFor(() => {
      expect(screen.getByText('未抓到任何视频')).toBeTruthy();
    });
    expect(screen.queryByText('采集中，稍后刷新查看视频结果')).toBeNull();
  });

  it('任务真的在跑(status=running)且无视频 → 仍显示"采集中，稍后刷新"', async () => {
    global.fetch = mockFetchByUrl({
      '/api/acquisition/collect-tasks/task-running/videos': {
        success: true,
        data: { videos: [], total: 0, task: { status: 'running', error_code: null, video_count: 0 } },
      },
    }) as unknown as typeof fetch;

    renderTaskDetail('task-running');

    await waitFor(() => {
      expect(screen.getByText('采集中，稍后刷新查看视频结果')).toBeTruthy();
    });
  });
});
