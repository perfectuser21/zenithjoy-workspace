import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import MachineSelector from './MachineSelector';
import * as machinesApi from '../api/machines.api';

const ONLINE_A = {
  id: 'm-a', agent_id: 'agent-a', hostname: 'ROG-PC', nickname: '西安ROG',
  machine_role: 'main' as const, status: 'online' as const, version: '1.0', last_seen: '', session_count: 0,
};
const ONLINE_B = {
  id: 'm-b', agent_id: 'agent-b', hostname: 'XIAN-PC', nickname: null,
  machine_role: 'sub' as const, status: 'online' as const, version: '1.0', last_seen: '', session_count: 0,
};
const OFFLINE_C = {
  id: 'm-c', agent_id: 'agent-c', hostname: 'MAC-M4', nickname: null,
  machine_role: 'sub' as const, status: 'offline' as const, version: '1.0', last_seen: '', session_count: 0,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

describe('MachineSelector — 方案C 机器选择器 [BEHAVIOR]', () => {
  it('0 台 online → 红色警告"无在线机器"', async () => {
    vi.spyOn(machinesApi, 'fetchMachines').mockResolvedValue([OFFLINE_C]);
    render(<MachineSelector />);
    await waitFor(() => {
      expect(screen.getByText(/无在线机器/)).toBeTruthy();
    });
  });

  it('1 台 online → 自动选中，写入 localStorage，不弹选择器', async () => {
    vi.spyOn(machinesApi, 'fetchMachines').mockResolvedValue([ONLINE_A, OFFLINE_C]);
    render(<MachineSelector />);
    await waitFor(() => {
      expect(localStorage.getItem('preferred_agent_id')).toBe('agent-a');
    });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/西安ROG|ROG-PC/)).toBeTruthy();
  });

  it('N 台 online 且无历史选择 → 弹出选择器', async () => {
    vi.spyOn(machinesApi, 'fetchMachines').mockResolvedValue([ONLINE_A, ONLINE_B]);
    render(<MachineSelector />);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });
  });

  it('选完机器后记住，写入 localStorage', async () => {
    vi.spyOn(machinesApi, 'fetchMachines').mockResolvedValue([ONLINE_A, ONLINE_B]);
    render(<MachineSelector />);
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'agent-b' } });
    await waitFor(() => {
      expect(localStorage.getItem('preferred_agent_id')).toBe('agent-b');
    });
  });

  it('已选中的机器掉线 → 橙色警告，重新触发选择', async () => {
    localStorage.setItem('preferred_agent_id', 'agent-c'); // 之前选的机器
    vi.spyOn(machinesApi, 'fetchMachines').mockResolvedValue([ONLINE_A, ONLINE_B, OFFLINE_C]);
    render(<MachineSelector />);
    await waitFor(() => {
      expect(screen.getByText(/离线|掉线/)).toBeTruthy();
    });
    // 掉线后应该重新可选（N 台在线，弹选择器）
    expect(screen.getByRole('combobox')).toBeTruthy();
  });
});
