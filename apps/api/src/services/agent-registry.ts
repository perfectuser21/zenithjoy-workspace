import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface AgentMeta {
  capabilities: string[];
  version: string;
}

export interface AgentEntry {
  agentId: string;
  meta: AgentMeta;
  ws: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
  busy: boolean;
}

export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, AgentEntry>();

  register(agentId: string, meta: AgentMeta, ws: WebSocket): void {
    const existing = this.agents.get(agentId);
    if (existing && existing.ws !== ws) {
      try {
        existing.ws.close(4001, 'replaced');
      } catch {
        // ignore close errors on stale ws
      }
    }
    const entry: AgentEntry = {
      agentId, meta, ws,
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

  pickFor(capability: string): AgentEntry | undefined {
    return this.list().find(e => e.meta.capabilities.includes(capability) && !e.busy);
  }
}

export const agentRegistry = new AgentRegistry();
