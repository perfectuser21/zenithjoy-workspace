import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcquisitionTasksPage from './AcquisitionTasksPage';

const BURNER_SESSIONS = [
  { account_label: 'burner-1', role: 'burner', status: 'active', bound_at: null, created_at: null, account_nickname: '小号A', hostname: 'ROG-PC', nickname: '西安ROG' },
  { account_label: 'burner-2', role: 'burner', status: 'expired', bound_at: null, created_at: null, account_nickname: '小号B(过期)', hostname: 'XIAN-PC', nickname: null },
];

function mockFetchByUrl(handlers: Record<string, unknown>) {
  return vi.fn((url: string) => {
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

describe('AcquisitionTasksPage — 方案D burner 账号选择 [BEHAVIOR]', () => {
  it('"使用账号"下拉只列 active session（过滤掉 expired）', async () => {
    global.fetch = mockFetchByUrl({
      '/api/acquisition/collect-tasks': { success: true, data: { tasks: [] } },
      '/api/agent/burner/sessions': { success: true, data: { sessions: BURNER_SESSIONS } },
      '/api/agent/machines': { success: true, data: [{ id: 'm-a', agent_id: 'agent-a', hostname: 'ROG-PC', nickname: '西安ROG', machine_role: 'main', status: 'online', version: '1.0', last_seen: '', session_count: 0 }] },
    }) as any;

    render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/小号A/)).toBeTruthy();
    });
    expect(screen.queryByText(/小号B/)).toBeNull();
  });

  it('选中账号后显示"将在 XX 上运行"', async () => {
    global.fetch = mockFetchByUrl({
      '/api/acquisition/collect-tasks': { success: true, data: { tasks: [] } },
      '/api/agent/burner/sessions': { success: true, data: { sessions: BURNER_SESSIONS } },
      '/api/agent/machines': { success: true, data: [{ id: 'm-a', agent_id: 'agent-a', hostname: 'ROG-PC', nickname: '西安ROG', machine_role: 'main', status: 'online', version: '1.0', last_seen: '', session_count: 0 }] },
    }) as any;

    render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);
    const select = await screen.findByLabelText(/使用账号/);
    fireEvent.change(select, { target: { value: 'burner-1' } });

    await waitFor(() => {
      expect(screen.getByText(/将在.*西安ROG.*运行|将在.*ROG-PC.*运行/)).toBeTruthy();
    });
  });

  it('提交时 body 带 account_label', async () => {
    const fetchMock = mockFetchByUrl({
      '/api/acquisition/collect-tasks': { success: true, data: { tasks: [] } },
      '/api/agent/burner/sessions': { success: true, data: { sessions: BURNER_SESSIONS } },
      '/api/agent/machines': { success: true, data: [{ id: 'm-a', agent_id: 'agent-a', hostname: 'ROG-PC', nickname: '西安ROG', machine_role: 'main', status: 'online', version: '1.0', last_seen: '', session_count: 0 }] },
      '/api/acquisition/collect/start': { success: true, data: { task_id: 't-1' } },
    });
    global.fetch = fetchMock as any;

    render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);
    const select = await screen.findByLabelText(/使用账号/);
    fireEvent.change(select, { target: { value: 'burner-1' } });

    const input = screen.getByPlaceholderText(/关键词/);
    fireEvent.change(input, { target: { value: '美甲' } });
    const btn = screen.getByText('开始采集');
    fireEvent.click(btn);

    await waitFor(() => {
      const startCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes('/collect/start')) as any[] | undefined;
      expect(startCall).toBeTruthy();
      const body = JSON.parse((startCall![1] as RequestInit).body as string);
      expect(body.account_label).toBe('burner-1');
    });
  });

  it('无在线机器 → 红色警告 + 禁止创建任务', async () => {
    global.fetch = mockFetchByUrl({
      '/api/acquisition/collect-tasks': { success: true, data: { tasks: [] } },
      '/api/agent/burner/sessions': { success: true, data: { sessions: [] } },
      '/api/agent/machines': { success: true, data: [{ id: 'm-c', agent_id: 'agent-c', hostname: 'MAC-M4', nickname: null, machine_role: 'sub', status: 'offline', version: '1.0', last_seen: '', session_count: 0 }] },
    }) as any;

    render(<MemoryRouter><AcquisitionTasksPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/无在线机器/)).toBeTruthy();
    });
    const input = screen.getByPlaceholderText(/关键词/);
    fireEvent.change(input, { target: { value: '美甲' } });
    const btn = screen.getByText('开始采集') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
