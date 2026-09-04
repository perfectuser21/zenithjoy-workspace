/**
 * OpenClaw 信号桥·件2 — CommandBridge：cmd 下行 / cmd_result 上行的 correlation 桥。
 *
 * 职责：
 *  - dispatchAndWait：占位（每设备同时 1 条在途）→ 下发 cmd → 按 msgId 等待回执/超时
 *  - handleCmdResult：agent-ws 收到 cmd_result 后按 payload.inReplyTo 找 pending 并 resolve
 *  - 订阅 registry 'unregister'：设备掉线 → 该设备全部 pending 立即 AGENT_DISCONNECTED
 *
 * 契约硬语义（sprints/09041815-openclaw-signal-bridge-api-bridge/prep-prd.md）：
 *  - 占位 check-and-set 在任何 await 之前同步完成，第二并发请求吃 DEVICE_BUSY
 *    （设备端本来就是串行队列，多发只是排队白占超时预算）
 *  - sendToAgent false → 立即释放占位并抛 NOT_CONNECTED，不白等 35s
 *  - resolve / timeout 都先 delete pending（含占位）再动作
 *  - 回执来源校验：fromAgentId !== pending.agentId → 丢弃 + warn（防串扰/伪造）
 *  - timeoutMs clamp [3000, 35000]
 *  - 迟到回执（pending 已删，常见于超时后设备照样执行完）→ 只 UPDATE
 *    device_command_log 不 INSERT（防 msg_id UNIQUE 炸），把真实结果补进审计
 *
 * ⚠️ 单副本约束：pending map 在进程内存里，prod 单容器成立；API 水平扩容前本桥
 * 必须改共享存储（Redis/pg），否则回执会落在不持有 pending 的副本上（PRD 双写）。
 */
import { agentRegistry } from './agent-registry';
import type { AgentEntry } from './agent-registry';
import { sendToAgent } from './agent-ws';
import type { CmdResultPayload } from '../schemas/agent-protocol';
import pool from '../db/connection';

export const TIMEOUT_MIN_MS = 3_000;
export const TIMEOUT_MAX_MS = 35_000;

export function clampTimeoutMs(ms?: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return TIMEOUT_MAX_MS;
  return Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, Math.floor(ms)));
}

export type BridgeErrorCode = 'NOT_CONNECTED' | 'DEVICE_BUSY' | 'DEVICE_TIMEOUT' | 'AGENT_DISCONNECTED';

export class CommandBridgeError extends Error {
  constructor(public readonly code: BridgeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CommandBridgeError';
  }
}

interface PendingEntry {
  agentId: string;
  resolve: (payload: CmdResultPayload) => void;
  reject: (err: CommandBridgeError) => void;
  timer: NodeJS.Timeout;
}

type SendFn = (agentId: string, msg: { v: 1; type: string; msgId: string; ts: number; payload: unknown }) => boolean;
interface RegistryLike {
  on(event: 'unregister', listener: (entry: AgentEntry) => void): unknown;
}

export class CommandBridge {
  private pending = new Map<string, PendingEntry>();
  /** agentId → 在途 msgId（每设备同时 1 条） */
  private inFlight = new Map<string, string>();

  constructor(
    private readonly send: SendFn = (agentId, msg) => sendToAgent(agentId, msg as Parameters<typeof sendToAgent>[1]),
    registry: RegistryLike = agentRegistry,
  ) {
    // 防御：部分既有测试对 agent-registry 的 mock 没有 EventEmitter 面（无 on）。
    // 真 agentRegistry 恒有 on；mock 无 on 时跳过订阅（那些测试不测掉线路径）。
    if (typeof registry.on === 'function') {
      registry.on('unregister', (entry) => this.failAllFor(entry.agentId));
    }
  }

  /**
   * 下发指令并等待回执。占位 check-and-set 与 send 全部同步完成（函数刻意不 async，
   * 返回 Promise —— 保证并发第二请求在任何 await 之前就吃到 DEVICE_BUSY）。
   */
  dispatchAndWait(
    agentId: string,
    action: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    msgId: string = crypto.randomUUID(),
  ): Promise<CmdResultPayload> {
    // I-1 纵深防线：同 msgId 已在途（跨 agent 撞 idempotencyKey）→ 拒绝。
    // pending map 以 msgId 为键，不拦会让第二个 dispatch 覆盖第一个的 entry，
    // 回执关联全乱（第一个永远等不到、第二个可能收到别台设备的结果）。
    if (this.pending.has(msgId)) {
      return Promise.reject(new CommandBridgeError('DEVICE_BUSY', `msgId ${msgId} 已在途（idempotencyKey 撞在途指令）`));
    }
    if (this.inFlight.has(agentId)) {
      return Promise.reject(new CommandBridgeError('DEVICE_BUSY', `agent ${agentId} 已有在途指令`));
    }
    this.inFlight.set(agentId, msgId); // 占位：在任何异步动作之前

    const msg = { v: 1 as const, type: 'cmd', msgId, ts: Date.now(), payload: { action, ...args } };
    let sent = false;
    try {
      sent = this.send(agentId, msg);
    } finally {
      if (!sent) this.inFlight.delete(agentId); // send 抛异常/返回 false 都释放占位
    }
    if (!sent) {
      return Promise.reject(new CommandBridgeError('NOT_CONNECTED', `agent ${agentId} 不在线（ws0 不可达）`));
    }

    // 调用方已 clampTimeoutMs，此处再内联夹逼一次：兜底防未来新调用点漏 clamp，
    // 也让 CodeQL js/resource-exhaustion 在本函数内看到 sanitizer（跨函数它追不到）
    const safeTimeoutMs = Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, timeoutMs));
    return new Promise<CmdResultPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 先删 pending（含占位）再动作
        this.pending.delete(msgId);
        this.inFlight.delete(agentId);
        reject(new CommandBridgeError('DEVICE_TIMEOUT', `等待回执超时（${safeTimeoutMs}ms）——结果未知，设备可能仍会执行`));
      }, safeTimeoutMs);
      timer.unref?.();
      this.pending.set(msgId, { agentId, resolve, reject, timer });
    });
  }

  /**
   * cmd_result 上行入口（agent-ws 调用）。返回是否命中 pending。
   * 迟到回执（超时后才到）只补 UPDATE 审计行，绝不 INSERT。
   */
  handleCmdResult(fromAgentId: string | null, payload: CmdResultPayload): boolean {
    const inReplyTo = payload.inReplyTo;
    if (!inReplyTo) {
      console.warn('[command-bridge] cmd_result 缺 inReplyTo，丢弃');
      return false;
    }
    const entry = this.pending.get(inReplyTo);
    if (!entry) {
      // I-2：迟到回执补审计必须带来源过滤；来源不明（hello 前的连接）一律不写。
      if (fromAgentId) {
        this.recordLateResult(inReplyTo, fromAgentId, payload);
      } else {
        console.warn('[command-bridge] 迟到回执来源 agentId 为空，不写审计');
      }
      return false;
    }
    if (entry.agentId !== fromAgentId) {
      console.warn(`[command-bridge] cmd_result 来源不符：pending.agentId=${entry.agentId} from=${fromAgentId}，丢弃`);
      return false;
    }
    // 先删 pending（含占位）再 resolve
    this.pending.delete(inReplyTo);
    this.inFlight.delete(entry.agentId);
    clearTimeout(entry.timer);
    entry.resolve(payload);
    return true;
  }

  /** 设备掉线：该设备全部 pending 立即 502 语义失败，不白等 35s。 */
  private failAllFor(agentId: string): void {
    for (const [msgId, entry] of this.pending) {
      if (entry.agentId !== agentId) continue;
      this.pending.delete(msgId);
      clearTimeout(entry.timer);
      entry.reject(new CommandBridgeError('AGENT_DISCONNECTED', `agent ${agentId} 连接断开`));
    }
    this.inFlight.delete(agentId);
  }

  /**
   * 迟到回执补审计：只 UPDATE（行由 route 在下发前 INSERT），防 msg_id UNIQUE 炸。
   * I-2：WHERE 带 agent_id = 来源设备——伪造/串扰的回执改写不了别台设备的审计行。
   */
  private recordLateResult(msgId: string, fromAgentId: string, payload: CmdResultPayload): void {
    try {
      Promise.resolve(pool.query(
        `UPDATE zenithjoy.device_command_log
            SET status = 'done',
                ok = $2,
                error_code = $3,
                latency_ms = (EXTRACT(EPOCH FROM (now() - created_at)) * 1000)::int
          WHERE msg_id = $1 AND agent_id = $4`,
        [msgId, payload.ok ?? null, payload.errorCode ?? null, fromAgentId],
      )).catch((e) => console.warn('[command-bridge] 迟到回执 UPDATE 失败:', e));
    } catch (e) {
      console.warn('[command-bridge] 迟到回执 UPDATE 失败:', e);
    }
  }
}

export const commandBridge = new CommandBridge();
