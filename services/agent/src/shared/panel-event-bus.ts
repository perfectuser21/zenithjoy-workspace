// 作战窗 Agent Panel 刀1 — 事件总线
// PrepPRD: sprints/07280929-agent-panel-knife1/prep-prd.md
//
// 6 种事件(task_started/step/waiting/stuck/done/failed) + 看门狗(默认90s无step判stuck)
// + 多task灯态max()聚合(stuck>waiting>干活中>done/idle)。
//
// 判定点（decisions表 category=judgment）：
// - 看门狗stuck阈值默认90秒，可调
// - 灯态聚合：前端max()取最高优先级状态，不需要逐task独立看门狗UI
// - stuck是过渡态非终态，等真实done/failed替换，本刀不做自动清理
// - 本地事件缓冲/最近完成列表上限，防长期运行拖垮面板

export type PanelEventType = 'task_started' | 'step' | 'waiting' | 'stuck' | 'done' | 'failed';
export type PanelSeverity = 'info' | 'warn' | 'error';
export type TaskState = 'work' | 'waiting' | 'stuck' | 'done' | 'failed';
export type LightState = 'work' | 'wait' | 'stuck' | 'idle';

export interface PanelEvent {
  event: PanelEventType;
  task_id: string;
  line: string;
  device: string;
  title: string;
  detail?: string;
  progress?: [number, number];
  severity?: PanelSeverity;
  ts: number;
}

export interface PanelTaskSnapshot {
  task_id: string;
  line: string;
  device: string;
  title: string;
  detail?: string;
  progress?: [number, number];
  state: TaskState;
  updated_at: number;
}

export interface PanelEventBusOptions {
  /** 看门狗超时阈值(ms)，默认90秒 */
  watchdogMs?: number;
  /** 最近完成列表本地保留条数上限，默认50 */
  recentLimit?: number;
}

const DEFAULT_WATCHDOG_MS = 90_000;
const DEFAULT_RECENT_LIMIT = 50;

// 灯态优先级：数字越大越"应该被看见"
const LIGHT_PRIORITY: Record<LightState, number> = {
  idle: 0,
  work: 1,
  wait: 2,
  stuck: 3,
};

function taskStateToLight(state: TaskState): LightState {
  if (state === 'stuck') return 'stuck';
  if (state === 'waiting') return 'wait';
  if (state === 'work') return 'work';
  return 'idle'; // done/failed 不在活跃列表里，聚合时不会被传入
}

export class PanelEventBus {
  private readonly watchdogMs: number;

  private readonly recentLimit: number;

  private readonly active = new Map<string, PanelTaskSnapshot>();

  private readonly recentByLine = new Map<string, PanelTaskSnapshot[]>();

  private readonly watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly changeListeners = new Set<() => void>();

  constructor(opts: PanelEventBusOptions = {}) {
    this.watchdogMs = opts.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.recentLimit = opts.recentLimit ?? DEFAULT_RECENT_LIMIT;
  }

  // xian-rog 真机验证实测发现：registerPanelEventRoutes 的 SSE stream 只在客户端首次连接时
  // 写一帧 snapshot，之后只发心跳注释，事件总线状态变了 SSE 从来没推过新帧——网页壳订阅了 SSE
  // 但实际收不到任何实时更新，"实时"看板根本不实时。onChange 让路由层能订阅状态变化，
  // 每次变化时主动推一帧新快照给所有连着的 SSE 客户端。
  onChange(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  ingest(evt: PanelEvent): void {
    switch (evt.event) {
      case 'task_started':
        this.upsertActive(evt, 'work');
        this.armWatchdog(evt.task_id);
        break;
      case 'step':
        this.upsertActive(evt, 'work');
        this.armWatchdog(evt.task_id);
        break;
      case 'waiting':
        this.upsertActive(evt, 'waiting');
        this.armWatchdog(evt.task_id);
        break;
      case 'stuck':
        // 看门狗自身也走这个事件类型（自发 stuck），外部也可能直接上报
        this.upsertActive(evt, 'stuck');
        break;
      case 'done':
        this.complete(evt, 'done');
        break;
      case 'failed':
        this.complete(evt, 'failed');
        break;
      default:
        return; // 未知事件类型不算真实变化，不通知订阅者
    }
    this.notifyChange();
  }

  getActiveTasks(line: string): PanelTaskSnapshot[] {
    return [...this.active.values()].filter((t) => t.line === line);
  }

  getRecentCompleted(line: string): PanelTaskSnapshot[] {
    return this.recentByLine.get(line) ?? [];
  }

  getLightState(line: string): LightState {
    const tasks = this.getActiveTasks(line);
    if (tasks.length === 0) return 'idle';
    let best: LightState = 'idle';
    for (const t of tasks) {
      const light = taskStateToLight(t.state);
      if (LIGHT_PRIORITY[light] > LIGHT_PRIORITY[best]) best = light;
    }
    return best;
  }

  destroy(): void {
    for (const timer of this.watchdogTimers.values()) clearTimeout(timer);
    this.watchdogTimers.clear();
  }

  private upsertActive(evt: PanelEvent, state: TaskState): void {
    const existing = this.active.get(evt.task_id);
    this.active.set(evt.task_id, {
      task_id: evt.task_id,
      line: evt.line,
      device: evt.device,
      title: evt.title,
      detail: evt.detail ?? existing?.detail,
      progress: evt.progress ?? existing?.progress,
      state,
      updated_at: evt.ts,
    });
  }

  private complete(evt: PanelEvent, state: 'done' | 'failed'): void {
    this.clearWatchdog(evt.task_id);
    const existing = this.active.get(evt.task_id);
    this.active.delete(evt.task_id);

    const snapshot: PanelTaskSnapshot = {
      task_id: evt.task_id,
      line: evt.line,
      device: evt.device,
      title: evt.title,
      detail: evt.detail ?? existing?.detail,
      progress: evt.progress ?? existing?.progress,
      state,
      updated_at: evt.ts,
    };

    const list = this.recentByLine.get(evt.line) ?? [];
    list.unshift(snapshot);
    if (list.length > this.recentLimit) list.length = this.recentLimit;
    this.recentByLine.set(evt.line, list);
  }

  private armWatchdog(taskId: string): void {
    this.clearWatchdog(taskId);
    const timer = setTimeout(() => {
      const task = this.active.get(taskId);
      if (!task) return; // 已经 done/failed，看门狗不应该再动它
      this.active.set(taskId, { ...task, state: 'stuck', updated_at: Date.now() });
      this.watchdogTimers.delete(taskId);
      this.notifyChange();
    }, this.watchdogMs);
    this.watchdogTimers.set(taskId, timer);
  }

  private clearWatchdog(taskId: string): void {
    const timer = this.watchdogTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.watchdogTimers.delete(taskId);
    }
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) {
      try {
        cb();
      } catch {
        // 一个订阅者(SSE连接)出错不该拖垮其它订阅者，同旁观者纪律
      }
    }
  }
}
