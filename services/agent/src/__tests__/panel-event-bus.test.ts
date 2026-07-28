import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import { PanelEventBus } from '../shared/panel-event-bus';

// 作战窗刀1事件总线：6种事件(task_started/step/waiting/stuck/done/failed)
// + 看门狗(默认90s无step判stuck) + 多task灯态max()聚合(stuck>waiting>干活中>done/idle)
// PrepPRD sprints/07280929-agent-panel-knife1/prep-prd.md Golden Path Step4-6
describe('PanelEventBus', () => {
  let bus: PanelEventBus;
  afterEach(() => {
    bus?.destroy();
    vi.useRealTimers();
  });

  describe('onChange 变更订阅（xian-rog真机验证实测发现的真实bug：registerPanelEventRoutes的'
    + 'SSE stream只在客户端首次连接时写一帧snapshot，之后只发心跳注释，事件总线状态变了'
    + '(task_started/step/waiting/stuck/done/failed) SSE从来没推过新帧——网页壳订阅了SSE但'
    + '实际收不到任何实时更新，页面必须重新连接/刷新才能看到最新状态，"实时"看板根本不实时）', () => {
    it('ingest task_started → onChange 回调触发', () => {
      bus = new PanelEventBus();
      const cb = vi.fn();
      bus.onChange(cb);
      bus.ingest({
        event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
      });
      expect(cb).toHaveBeenCalled();
    });

    it('看门狗自发触发stuck（不经ingest）→ 同样要触发 onChange，否则灯态变红网页也收不到通知', () => {
      vi.useFakeTimers();
      bus = new PanelEventBus({ watchdogMs: 1000 });
      const cb = vi.fn();
      bus.ingest({
        event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
      });
      bus.onChange(cb); // task_started的那次调用不算，只关心看门狗自己触发的
      cb.mockClear();
      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalled();
      expect(bus.getActiveTasks('line04')[0].state).toBe('stuck');
    });

    it('取消订阅(unsubscribe)后不再收到通知', () => {
      bus = new PanelEventBus();
      const cb = vi.fn();
      const unsubscribe = bus.onChange(cb);
      unsubscribe();
      bus.ingest({
        event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
      });
      expect(cb).not.toHaveBeenCalled();
    });

    it('一个回调抛异常不影响其它订阅者收到通知（多个SSE客户端场景，一个连接坏了不该拖垮其它连接）', () => {
      bus = new PanelEventBus();
      const bad = vi.fn(() => { throw new Error('boom'); });
      const good = vi.fn();
      bus.onChange(bad);
      bus.onChange(good);
      expect(() => {
        bus.ingest({
          event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
        });
      }).not.toThrow();
      expect(good).toHaveBeenCalled();
    });
  });

  it('task_started → 出现在活跃任务列表，状态 work', () => {
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc',
      title: '回复客户张三', ts: Date.now(),
    });
    const active = bus.getActiveTasks('line04');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ task_id: 't1', state: 'work', title: '回复客户张三' });
  });

  it('step → 原地刷新卡内文案，不新增卡片，状态仍是 work', () => {
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三', ts: Date.now(),
    });
    bus.ingest({
      event: 'step', task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三',
      detail: '第2/5步：读取对话历史', progress: [2, 5], ts: Date.now(),
    });
    const active = bus.getActiveTasks('line04');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ state: 'work', detail: '第2/5步：读取对话历史', progress: [2, 5] });
  });

  it('waiting → 状态变 waiting，且与 stuck 语义不同（业务正常态可长期停留）', () => {
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    bus.ingest({
      event: 'waiting', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x',
      detail: '等待中：客户扫码', ts: Date.now(),
    });
    expect(bus.getActiveTasks('line04')[0]).toMatchObject({ state: 'waiting', detail: '等待中：客户扫码' });
  });

  it('done → 从活跃列表移除，进入最近完成列表', () => {
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三', ts: Date.now(),
    });
    bus.ingest({
      event: 'done', task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三', ts: Date.now(),
    });
    expect(bus.getActiveTasks('line04')).toHaveLength(0);
    const recent = bus.getRecentCompleted('line04');
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ task_id: 't1', state: 'done' });
  });

  it('failed → 从活跃列表移除，进入最近完成列表并标记 failed + 原因', () => {
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line02', device: 'xian-rog', title: 'x', ts: Date.now(),
    });
    bus.ingest({
      event: 'failed', task_id: 't1', line: 'line02', device: 'xian-rog', title: 'x',
      detail: '私信触达超时未达', ts: Date.now(),
    });
    expect(bus.getActiveTasks('line02')).toHaveLength(0);
    expect(bus.getRecentCompleted('line02')[0]).toMatchObject({ state: 'failed', detail: '私信触达超时未达' });
  });

  it('看门狗：task_started 后 90 秒内无 step → 自动判定 stuck（proven-to-fire）', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    expect(bus.getActiveTasks('line04')[0].state).toBe('work');

    vi.advanceTimersByTime(90_000);

    expect(bus.getActiveTasks('line04')[0].state).toBe('stuck');
  });

  it('看门狗：89.9 秒时收到 step 事件 → 计时器重置，不判 stuck', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    vi.advanceTimersByTime(89_900);
    bus.ingest({
      event: 'step', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', detail: '继续', ts: Date.now(),
    });
    vi.advanceTimersByTime(89_900);
    expect(bus.getActiveTasks('line04')[0].state).toBe('work');
  });

  it('看门狗：stuck 是过渡态不是终态，真实 done 到达后替换掉 stuck 卡片', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    vi.advanceTimersByTime(90_000);
    expect(bus.getActiveTasks('line04')[0].state).toBe('stuck');

    bus.ingest({
      event: 'done', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    expect(bus.getActiveTasks('line04')).toHaveLength(0);
    expect(bus.getRecentCompleted('line04')[0]).toMatchObject({ task_id: 't1', state: 'done' });
  });

  it('done/failed 到达后看门狗计时器必须清除，不会在之后延迟触发 stuck', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    bus.ingest({
      event: 'done', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    vi.advanceTimersByTime(200_000);
    // 90s后如果计时器没清，会尝试把一个已经不存在于活跃列表的task标记stuck——
    // 用最近完成列表状态没被污染来验证清除生效
    expect(bus.getRecentCompleted('line04')[0].state).toBe('done');
  });

  it('可自定义看门狗阈值（不是写死90秒）', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus({ watchdogMs: 5_000 });
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    vi.advanceTimersByTime(5_000);
    expect(bus.getActiveTasks('line04')[0].state).toBe('stuck');
  });

  it('灯态聚合：同一业务线多task并发，取最高优先级 stuck>waiting>work>idle', () => {
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line02', device: 'a', title: 'x', ts: Date.now(),
    });
    bus.ingest({
      event: 'task_started', task_id: 't2', line: 'line02', device: 'b', title: 'y', ts: Date.now(),
    });
    bus.ingest({
      event: 'waiting', task_id: 't2', line: 'line02', device: 'b', title: 'y', ts: Date.now(),
    });
    // t1=work, t2=waiting → 线整体取更高优先级 waiting
    expect(bus.getLightState('line02')).toBe('wait');
  });

  it('灯态聚合：无任何任务的业务线 → idle', () => {
    bus = new PanelEventBus();
    expect(bus.getLightState('line04')).toBe('idle');
  });

  it('灯态聚合：一个 task stuck 即使其他 task 仍在正常工作，整线也变红', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'a', title: 'x', ts: Date.now(),
    });
    bus.ingest({
      event: 'task_started', task_id: 't2', line: 'line04', device: 'b', title: 'y', ts: Date.now(),
    });
    // t2 每 30s 打一次 step，永不 stuck；t1 完全不动，90s 后 stuck
    vi.advanceTimersByTime(30_000);
    bus.ingest({
      event: 'step', task_id: 't2', line: 'line04', device: 'b', title: 'y', detail: '仍在跑', ts: Date.now(),
    });
    vi.advanceTimersByTime(60_000);
    expect(bus.getLightState('line04')).toBe('stuck');
  });

  it('最近完成列表本地保留最近 50 条，超出自动裁剪（本地缓冲/列表上限判定点）', () => {
    bus = new PanelEventBus();
    for (let i = 0; i < 55; i += 1) {
      const taskId = `t${i}`;
      bus.ingest({
        event: 'task_started', task_id: taskId, line: 'line04', device: 'a', title: `task${i}`, ts: Date.now(),
      });
      bus.ingest({
        event: 'done', task_id: taskId, line: 'line04', device: 'a', title: `task${i}`, ts: Date.now(),
      });
    }
    const recent = bus.getRecentCompleted('line04');
    expect(recent).toHaveLength(50);
    // 最新的排最前面，最旧的 5 条(t0-t4)已被裁掉
    expect(recent[0].task_id).toBe('t54');
    expect(recent.find((r) => r.task_id === 't0')).toBeUndefined();
  });

  it('destroy() 清除所有看门狗计时器，不留悬挂定时器', () => {
    vi.useFakeTimers();
    bus = new PanelEventBus();
    bus.ingest({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'a', title: 'x', ts: Date.now(),
    });
    bus.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
