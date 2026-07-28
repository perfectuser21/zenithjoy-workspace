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

  describe('离线重连摘要（PrepPRD Golden Path Step10："重连成功后对期间产生的done/failed事件'
    + '一次性弹出摘要"——重连后拿的是快照不是重放事件流，只能靠对比重连前后recentCompleted差集算出）', () => {
    const line04Base = {
      line: 'line04', connected: true, lightState: 'idle' as const, activeTasks: [],
    };

    it('断线期间产生的done/failed → 重连后 reconnectSummary 报出新增的完成/失败数', async () => {
      const { result } = renderHook(() => useAgentPanelState());
      const es = MockEventSource.instances[0];

      act(() => {
        es.emit('snapshot', {
          data: JSON.stringify([{
            ...line04Base,
            recentCompleted: [{
              task_id: 't1', line: 'line04', device: 'd', title: '任务1', state: 'done',
            }],
          }]),
        });
      });
      await waitFor(() => expect(result.current.connected).toBe(true));

      act(() => { es.emit('error', {}); });
      await waitFor(() => expect(result.current.connected).toBe(false));

      // 重连：快照里 recentCompleted 比断线前多了 t2(done)/t3(failed) 两条
      act(() => {
        es.emit('snapshot', {
          data: JSON.stringify([{
            ...line04Base,
            recentCompleted: [
              { task_id: 't3', line: 'line04', device: 'd', title: '任务3', state: 'failed' },
              { task_id: 't2', line: 'line04', device: 'd', title: '任务2', state: 'done' },
              { task_id: 't1', line: 'line04', device: 'd', title: '任务1', state: 'done' },
            ],
          }]),
        });
      });

      await waitFor(() => expect(result.current.reconnectSummary).toEqual({ done: 1, failed: 1 }));
    });

    it('从未断线过 → reconnectSummary 恒为 null（不是首次快照就误报摘要）', async () => {
      const { result } = renderHook(() => useAgentPanelState());
      const es = MockEventSource.instances[0];
      act(() => {
        es.emit('snapshot', {
          data: JSON.stringify([{
            ...line04Base,
            recentCompleted: [{
              task_id: 't1', line: 'line04', device: 'd', title: '任务1', state: 'done',
            }],
          }]),
        });
      });
      await waitFor(() => expect(result.current.connected).toBe(true));
      expect(result.current.reconnectSummary).toBeNull();
    });

    it('断线期间恰好没有新完成/失败任务 → 不弹摘要(reconnectSummary仍为null)', async () => {
      const { result } = renderHook(() => useAgentPanelState());
      const es = MockEventSource.instances[0];
      const snapshot = [{
        ...line04Base,
        recentCompleted: [{
          task_id: 't1', line: 'line04', device: 'd', title: '任务1', state: 'done',
        }],
      }];
      act(() => { es.emit('snapshot', { data: JSON.stringify(snapshot) }); });
      await waitFor(() => expect(result.current.connected).toBe(true));

      act(() => { es.emit('error', {}); });
      await waitFor(() => expect(result.current.connected).toBe(false));

      act(() => { es.emit('snapshot', { data: JSON.stringify(snapshot) }); });
      await waitFor(() => expect(result.current.connected).toBe(true));
      expect(result.current.reconnectSummary).toBeNull();
    });

    it('dismissReconnectSummary() 清空摘要，供UI点掉/自动消失后调用', async () => {
      const { result } = renderHook(() => useAgentPanelState());
      const es = MockEventSource.instances[0];
      act(() => {
        es.emit('snapshot', {
          data: JSON.stringify([{ ...line04Base, recentCompleted: [] }]),
        });
      });
      await waitFor(() => expect(result.current.connected).toBe(true));
      act(() => { es.emit('error', {}); });
      await waitFor(() => expect(result.current.connected).toBe(false));
      act(() => {
        es.emit('snapshot', {
          data: JSON.stringify([{
            ...line04Base,
            recentCompleted: [{
              task_id: 't1', line: 'line04', device: 'd', title: '任务1', state: 'done',
            }],
          }]),
        });
      });
      await waitFor(() => expect(result.current.reconnectSummary).toEqual({ done: 1, failed: 0 }));

      act(() => { result.current.dismissReconnectSummary(); });
      expect(result.current.reconnectSummary).toBeNull();
    });
  });
});
