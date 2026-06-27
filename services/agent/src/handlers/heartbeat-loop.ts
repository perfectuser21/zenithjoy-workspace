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

export type ModuleState = 'active' | 'locked' | 'not_purchased';

// 服务端可下发简单字符串状态，或带 required_version 的描述对象（协议双向扩展）
export interface ModuleDescriptor {
  status: ModuleState | string;
  required_version?: string;
}

// 客户端上报的单模块健康（preflight 结果 + 自愈件4 listen_chat 真实健康字段）
export interface ModuleStatusReport {
  ok: boolean;
  reason?: string;
  // 自愈件4：line04 listen_chat 真实健康（进程在不在 / 微信窗口找到没 / 最近一次成功送达 ms）
  listener_alive?: boolean;
  found_window?: boolean;
  last_delivery_ts?: number;
}

// 核心自升级（Sprint 06222100）：中台下发的 Agent 核心要求版本（含 sha256/size 供下载校验）
export interface RequiredAgentVersion {
  version: string;
  sha256?: string;
  size?: number;
}

export interface HeartbeatResponse {
  ok: boolean;
  agent_id: string;
  queued_tasks?: HeartbeatTask[];
  modules?: Record<string, ModuleState | ModuleDescriptor>;
  // 核心自升级信号：> 自身 version 时客户端下载新核心包自换重启
  required_agent_version?: RequiredAgentVersion;
}

export interface HeartbeatLoopOptions {
  apiBase: string;
  license: string;
  version: string;
  hostname: string;
  // 身份统一（cp-06270030）：register 返的 agents.id (UUID)。
  // 随每次心跳上报，让中台按 (tenant, hostname) 复用同一行，不再生成新 ws1-<hash> 裂身份。
  agentUuid?: string;
  osType?: string;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  onTask?: (task: HeartbeatTask) => Promise<void> | void;
  onHeartbeat?: (resp: HeartbeatResponse) => void;
  onError?: (err: unknown) => void;
}

export class HeartbeatLoop {
  private agentId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  // 最近一次各模块 preflight 结果，随下一次心跳 POST body 上报中台
  private moduleStatus: Record<string, ModuleStatusReport> | null = null;
  private readonly opts: Required<
    Pick<HeartbeatLoopOptions, 'apiBase' | 'license' | 'version' | 'hostname'>
  > & {
    agentUuid?: string;
    osType?: string;
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
      agentUuid: options.agentUuid,
      osType: options.osType,
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

  // 由调用方（index.ts）在跑完 preflight 后写入，随下次心跳上报
  setModuleStatus(status: Record<string, ModuleStatusReport>): void {
    this.moduleStatus = status;
  }

  async sendOnce(): Promise<HeartbeatResponse | null> {
    const url = `${this.opts.apiBase}/api/agent/heartbeat`;
    const body: Record<string, unknown> = {
      license: this.opts.license,
      version: this.opts.version,
      hostname: this.opts.hostname,
      os_type: this.opts.osType,
    };
    // 身份统一（cp-06270030）：
    //   - agent_id 优先用响应已收敛的 id；首次心跳响应还没回来时退回 register UUID，
    //     让中台第一次就能按 UUID/(tenant,hostname) 命中复用行，不再 INSERT 新 ws1-<hash>。
    //   - 额外带 agent_uuid（register 返的稳定 UUID）供中台明确匹配，不被运行期 id 漂移影响。
    const agentIdToSend = this.agentId ?? this.opts.agentUuid;
    if (agentIdToSend) body.agent_id = agentIdToSend;
    if (this.opts.agentUuid) body.agent_uuid = this.opts.agentUuid;
    if (this.moduleStatus) body.module_status = this.moduleStatus;

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
