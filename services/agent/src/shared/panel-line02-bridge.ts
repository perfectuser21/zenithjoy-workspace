// PanelLine02Bridge — 桥接中台 line02(安卓) panel-active-tasks 数据 → 本地 PanelEventBus。
// Sprint 07282119-agent-panel-knife2-android（Golden Path Step 6）
//
// 与 PanelEventsTail（本机 panel-events.jsonl file-tail，line04 用）同款"轮询→bus.ingest()"
// 模式，只是数据源从本机文件换成跨主机 HTTP：
//   GET {apiBase}/api/agent/burner/panel-active-tasks?line=line02
// 安卓设备本身不跑本 Node 进程（跨设备），中台是唯一的数据真相来源，本桥接把中台已经算好的
// activeTasks/recentCompleted 转成 PanelEvent 喂给真实 PanelEventBus.ingest()，
// 让 apps/agent-panel 现有 SSE 消费链路（本地 /api/agent/panel/events/stream）也能看到 line02。
//
// 失败语义（判定点已登记）：桥接轮询 fetch 失败（网络/中台不可达）不得让本地 Agent 进程崩溃，
// 静默跳过本轮 ingest，line02 泳道保持上一次已知状态，不因单次轮询失败就整体标 disconnected，
// 也不得让故障传播到 line04（隔离原则）。

import { PanelEventBus, PanelEvent, PanelEventType } from './panel-event-bus';

export interface PanelLine02BridgeOptions {
  bus: PanelEventBus;
  apiBase: string;
  tenantId: string;
  agentId: string;
  /** 轮询周期(ms)，默认10秒 */
  pollIntervalMs?: number;
}

interface RemoteTaskSnapshot {
  task_id: string;
  device: string;
  title: string;
  detail?: string | null;
  progress?: [number, number] | null;
  state: string;
}

interface PanelActiveTasksResponse {
  line: string;
  activeTasks: RemoteTaskSnapshot[];
  recentCompleted: RemoteTaskSnapshot[];
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;

// activeTasks 里的 state（work/waiting/stuck，中台已算好）→ PanelEventBus 认得的 PanelEventType。
// bus.ingest() 内部按 event 类型决定 upsertActive 的 state，这里只需要把中台已经算好的
// "当前应处于什么状态"重新表达为一次事件即可，不重新计算看门狗（本地 bus 会对这些 task_id
// 再套一层本地 90s 看门狗——无害：中台 3 分钟阈值仍是权威判定来源，poll 周期内会不断喂新事件
// 续命，本地看门狗不会抢先误判，真正的 stuck 语义仍来自中台聚合出的 state）。
function activeStateToEventType(state: string): PanelEventType | null {
  switch (state) {
    case 'work': return 'step';
    case 'waiting': return 'waiting';
    case 'stuck': return 'stuck';
    default: return null;
  }
}

export class PanelLine02Bridge {
  private readonly bus: PanelEventBus;

  private readonly apiBase: string;

  private readonly tenantId: string;

  private readonly agentId: string;

  private readonly pollIntervalMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: PanelLine02BridgeOptions) {
    this.bus = opts.bus;
    this.apiBase = opts.apiBase;
    this.tenantId = opts.tenantId;
    this.agentId = opts.agentId;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    try {
      const url = `${this.apiBase}/api/agent/burner/panel-active-tasks?line=line02`;
      const resp = await fetch(url, {
        headers: {
          'X-Tenant-Id': this.tenantId,
          'x-agent-id': this.agentId,
        },
      });
      if (!resp.ok) return; // 静默降级，不清空 bus 已有状态
      const data = (await resp.json()) as PanelActiveTasksResponse;
      this.ingestSnapshot(data);
    } catch (err) {
      // 网络故障/中台不可达：不崩溃、不清空 bus 已有状态（静默降级，不得让故障传播到 line04）
      console.warn('[panel-line02-bridge] poll failed (静默降级，保留上次已知状态):', err);
    }
  }

  private ingestSnapshot(data: PanelActiveTasksResponse): void {
    const now = Date.now();

    for (const t of data.activeTasks ?? []) {
      const eventType = activeStateToEventType(t.state);
      if (!eventType) continue;
      const evt: PanelEvent = {
        event: eventType,
        task_id: t.task_id,
        line: 'line02',
        device: t.device,
        title: t.title,
        ts: now,
      };
      if (typeof t.detail === 'string') evt.detail = t.detail;
      if (Array.isArray(t.progress)) evt.progress = t.progress;
      this.bus.ingest(evt);
    }

    for (const t of data.recentCompleted ?? []) {
      const eventType: PanelEventType = t.state === 'failed' ? 'failed' : 'done';
      const evt: PanelEvent = {
        event: eventType,
        task_id: t.task_id,
        line: 'line02',
        device: t.device,
        title: t.title,
        ts: now,
      };
      if (typeof t.detail === 'string') evt.detail = t.detail;
      if (Array.isArray(t.progress)) evt.progress = t.progress;
      this.bus.ingest(evt);
    }
  }
}
