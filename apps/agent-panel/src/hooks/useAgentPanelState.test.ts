import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAgentPanelState } from './useAgentPanelState';

// jsdom 没有原生 EventSource，手写一个可控 mock：记录监听器，测试里手动触发。
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;

  listeners: Record<string, ((evt: unknown) => void)[]> = {};

  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (evt: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  emit(type: string, evt: unknown) {
    (this.listeners[type] ?? []).forEach((cb) => cb(evt));
  }

  close() {
    this.closed = true;
  }
}

describe('useAgentPanelState（本地SSE订阅，快照数据源=本地Agent内存）', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
  });
  afterEach(() => { delete (globalThis as any).EventSource; });

  it('挂载时连接本地 Agent 的 panel events SSE 端点(58432端口)', () => {
    renderHook(() => useAgentPanelState());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('http://localhost:58432/api/agent/panel/events/stream');
  });

  it('初始状态 connected=false, lines=[]', () => {
    const { result } = renderHook(() => useAgentPanelState());
    expect(result.current.connected).toBe(false);
    expect(result.current.lines).toEqual([]);
  });

  it('收到 snapshot 事件 → 解析data并更新lines，connected变true', async () => {
    const { result } = renderHook(() => useAgentPanelState());
    const es = MockEventSource.instances[0];
    const snapshot = [{
      line: 'line04', connected: true, lightState: 'work', activeTasks: [], recentCompleted: [],
    }];
    act(() => {
      es.emit('snapshot', { data: JSON.stringify(snapshot) });
    });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.lines).toEqual(snapshot);
  });

  it('收到 error 事件 → connected变false（本地SSE断线态）', async () => {
    const { result } = renderHook(() => useAgentPanelState());
    const es = MockEventSource.instances[0];
    act(() => { es.emit('open', {}); });
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => { es.emit('error', {}); });
    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  it('坏帧(非法JSON) → 不崩，静默跳过（面板旁观者纪律）', () => {
    const { result } = renderHook(() => useAgentPanelState());
    const es = MockEventSource.instances[0];
    expect(() => {
      act(() => { es.emit('snapshot', { data: '{{{ 坏JSON' }); });
    }).not.toThrow();
    expect(result.current.lines).toEqual([]);
  });

  it('卸载时关闭 EventSource 连接，不留悬挂连接', () => {
    const { unmount } = renderHook(() => useAgentPanelState());
    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });
});
