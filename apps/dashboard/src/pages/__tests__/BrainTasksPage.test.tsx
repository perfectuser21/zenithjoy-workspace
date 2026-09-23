/**
 * BrainTasksPage — 任务总台（读 Brain task database）
 *
 * 0923 主理人定的范围：**生产前端只负责把 task database 里的任务显示出来**。
 * 留痕（谁跑的、跑多久、烧了多少 token）不在这一页，也不做 UI。
 *
 * 为什么单开一页：现有 AcquisitionTasksPage 读的是 ZenithJoy 自己的
 * `/api/acquisition/collect-tasks`（采集任务），跟 Brain 的 task database 不是一回事。
 * 两者混在一页会让"我到底在看哪本账"说不清。
 *
 * 通路：nginx 已有 `/api/brain/` → 100.71.151.105:5221 的代理，生产实测 HTTP 200。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BrainTasksPage from '../BrainTasksPage';

const TASKS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    title: '今晚 22:00 · 金诺 · 采收「人工智能训练师考证」',
    description: '小蓝，6 个词',
    priority: 'P1',
    status: 'queued',
    task_type: 'device_job',
    queued_at: '2026-09-23T06:00:00.000Z',
    due_at: '2026-09-23T14:00:00.000Z',
    updated_at: '2026-09-23T06:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    title: '债：Deploy Preview 在所有 PR 上 503',
    description: '',
    priority: 'P2',
    status: 'in_progress',
    task_type: 'harness_initiative',
    queued_at: '2026-09-22T02:00:00.000Z',
    due_at: null,
    updated_at: '2026-09-23T01:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000003',
    title: '已经跑完的活',
    description: '',
    priority: 'P3',
    status: 'completed',
    task_type: 'dev',
    queued_at: '2026-09-20T02:00:00.000Z',
    due_at: null,
    updated_at: '2026-09-21T01:00:00.000Z',
  },
];

function mockFetch(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  } as Response);
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <BrainTasksPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch(TASKS));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BrainTasksPage', () => {
  it('把 task database 里的任务列出来', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/今晚 22:00 · 金诺/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Deploy Preview 在所有 PR 上 503/)).toBeInTheDocument();
  });

  it('打的是 Brain 的接口，不是 ZenithJoy 自己的采集任务表', async () => {
    const f = mockFetch(TASKS);
    vi.stubGlobal('fetch', f);
    renderPage();
    await waitFor(() => expect(f).toHaveBeenCalled());
    const url = String(f.mock.calls[0][0]);
    expect(url).toMatch(/\/api\/brain\/tasks/);
    // 这一页要是读成了 collect-tasks，看的就是另一本账了
    expect(url).not.toMatch(/collect-tasks/);
  });

  it('显示任务类型 —— 没有类型就分不出哪条是派给手机的活', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/今晚 22:00 · 金诺/)).toBeInTheDocument());
    expect(screen.getByText('device_job')).toBeInTheDocument();
    expect(screen.getByText('harness_initiative')).toBeInTheDocument();
  });

  it('显示状态和截止时间 —— "排着没跑"和"正在跑"要一眼分得出', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/今晚 22:00 · 金诺/)).toBeInTheDocument());
    expect(screen.getByText('排队中')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    // due_at 落在页面上。⚠️ 绝不能硬编码 "09-23 22:00"：那是 mock 的 14:00Z 在 UTC+8 下的
    // 样子，而 CI runner 跑在 UTC，同一条数据渲染成 "09-23 14:00" —— 本地全绿、CI 当场挂，
    // 第一版就是这么栽的。这里只断言「渲染成了 MM-DD HH:MM 的时间」，时区无关。
    const cells = screen.getAllByText(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('没有截止时间的任务显示「—」，不是 NaN 也不是空白', async () => {
    // TASKS 里第 2、3 条 due_at 是 null。Date(null) 会得到 1970 而不是 Invalid Date，
    // 稍不留神就会在页面上渲染出「01-01 08:00」这种凭空捏造的日期。
    renderPage();
    await waitFor(() => expect(screen.getByText(/今晚 22:00 · 金诺/)).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('接口挂了要说"读取失败"，绝不能显示成一张空表', async () => {
    // 空表和读不到长得一样，是最坏的情形：人会以为"今天没排活"，
    // 而实际是后台断了。0923 主理人已经在 Brain 库连接上踩过一次同样的坑。
    vi.stubGlobal('fetch', mockFetch({ error: 'BRAIN_UNAVAILABLE' }, false, 502));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/读取失败/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/暂无任务/)).not.toBeInTheDocument();
  });

  it('真的一条都没有时，说清楚是"没排活"而不是"读不到"', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/暂无任务/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/读取失败/)).not.toBeInTheDocument();
  });

  it('数据截至时间要标出来 —— 看的是几点的账得让人知道', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/今晚 22:00 · 金诺/)).toBeInTheDocument());
    expect(screen.getByText(/数据截至/)).toBeInTheDocument();
  });
});
