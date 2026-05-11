import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface AgentMeta {
  capabilities: string[];
  version: string;
  tenantId: string;   // populated from WS upgrade license validation
  displayName?: string; // H-1 ws3: 老 v1.0 Agent 发的 string agentId, 仅作 log + UI display
}

export interface AgentEntry {
  agentId: string;       // H-1 ws3: 真 routing key = agents.id (UUID), 不再是 string display name
  displayName: string;   // H-1 ws3: 原 hello.agentId (string), 用于 log + UI 显示, 不作 routing
  meta: AgentMeta;
  ws: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
  busy: boolean;
}

export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, AgentEntry>();

  // H-1 ws3: agentId 是 UUID (agents.id), displayName 是原 hello string (log only)
  // 老调用方仍可不传 displayName，自动 fallback 到 agentId（向后兼容）
  register(agentId: string, meta: AgentMeta, ws: WebSocket, displayName?: string): void {
    const existing = this.agents.get(agentId);
    if (existing && existing.ws !== ws) {
      try {
        existing.ws.close(4001, 'replaced');
      } catch {
        // ignore close errors on stale ws
      }
    }
    const entry: AgentEntry = {
      agentId,
      displayName: displayName || meta.displayName || agentId,
      meta,
      ws,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      busy: false,
    };
    this.agents.set(agentId, entry);
    this.emit('register', entry);
  }

  unregister(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      this.agents.delete(agentId);
      this.emit('unregister', entry);
    }
  }

  heartbeat(agentId: string, payload: { uptime: number; busy: boolean }): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.lastHeartbeat = Date.now();
    entry.busy = payload.busy;
    this.emit('heartbeat', entry);
  }

  list(): AgentEntry[] {
    return Array.from(this.agents.values());
  }

  get(agentId: string): AgentEntry | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Pick an available agent for a capability.
   * When tenantId is provided, only agents belonging to that tenant are eligible
   * (prevents cross-tenant task dispatch). Debug/test routes may omit tenantId.
   */
  pickFor(capability: string, tenantId?: string): AgentEntry | undefined {
    return this.list().find(
      e => (!tenantId || e.meta.tenantId === tenantId) &&
           e.meta.capabilities.includes(capability) &&
           !e.busy
    );
  }
}

export const agentRegistry = new AgentRegistry();
