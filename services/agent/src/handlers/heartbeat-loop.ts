// services/agent/src/handlers/heartbeat-loop.ts
//
// Walking Skeleton #1 — heartbeat loop
//
// 启动后每 intervalMs（默认 30s）调一次 POST /api/agent/heartbeat。
// 第一次响应里的 agent_id 记下来，后续请求一并带上。
// 中台返回 queued_tasks 数组里每个任务派发到 onTask 回调，由调用方按 type
// 路由到具体 handler（qr_bind/douyin、folder/bind、publish/douyin 等）。
//
// 设计取舍：
//   - 不直接依赖具体的 handler 模块，把分发交给上层（index.ts），方便测试和扩展
//   - 网络异常 / 非 2xx 响应都返回 null，绝不抛进事件循环
//   - fetchImpl 注入是为了 unit test，生产用 Node 18+ 自带 global fetch

export interface HeartbeatTask {
  task_id: string;
  platform: string;
  type?: 'video' | 'image' | 'article';
  payload: Record<string, unknown>;
}

export interface HeartbeatResponse {
  ok: boolean;
  agent_id: string;
  queued_tasks?: HeartbeatTask[];
}

export interface HeartbeatLoopOptions {
  apiBase: string;
  license: string;
  version: string;
  hostname: string;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  onTask?: (task: HeartbeatTask) => Promise<void> | void;
  onHeartbeat?: (resp: HeartbeatResponse) => void;
  onError?: (err: unknown) => void;
}

export class HeartbeatLoop {
  private agentId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<
    Pick<HeartbeatLoopOptions, 'apiBase' | 'license' | 'version' | 'hostname'>
  > & {
    intervalMs: number;
    fetchImpl: typeof fetch;
    onTask?: (task: HeartbeatTask) => Promise<void> | void;
    onHeartbeat?: (resp: HeartbeatResponse) => void;
    onError?: (err: unknown) => void;
  };

  constructor(options: HeartbeatLoopOptions) {
    this.opts = {
      apiBase: options.apiBase.replace(/\/+$/, ''),
      license: options.license,
      version: options.version,
      hostname: options.hostname,
      intervalMs: options.intervalMs ?? 30_000,
      fetchImpl: options.fetchImpl ?? (globalThis.fetch as typeof fetch),
      onTask: options.onTask,
      onHeartbeat: options.onHeartbeat,
      onError: options.onError,
    };
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  async sendOnce(): Promise<HeartbeatResponse | null> {
    const url = `${this.opts.apiBase}/api/agent/heartbeat`;
    const body: Record<string, unknown> = {
      license: this.opts.license,
      version: this.opts.version,
      hostname: this.opts.hostname,
    };
    if (this.agentId) body.agent_id = this.agentId;

    let resp: Response;
    try {
      resp = await this.opts.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.opts.onError?.(err);
      return null;
    }

    if (!resp.ok) {
      this.opts.onError?.(new Error(`heartbeat http ${resp.status}`));
      return null;
    }

    let data: HeartbeatResponse;
    try {
      data = (await resp.json()) as HeartbeatResponse;
    } catch (err) {
      this.opts.onError?.(err);
      return null;
    }

    if (!data.ok || !data.agent_id) {
      this.opts.onError?.(new Error('heartbeat response missing ok/agent_id'));
      return null;
    }

    this.agentId = data.agent_id;
    this.opts.onHeartbeat?.(data);

    if (data.queued_tasks && data.queued_tasks.length > 0 && this.opts.onTask) {
      for (const task of data.queued_tasks) {
        try {
          await this.opts.onTask(task);
        } catch (err) {
          this.opts.onError?.(err);
        }
      }
    }

    return data;
  }

  start(): void {
    if (this.timer) return;
    // Fire immediately so first heartbeat doesn't have to wait intervalMs
    void this.sendOnce();
    this.timer = setInterval(() => {
      void this.sendOnce();
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
