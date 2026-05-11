import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { agentRegistry } from './agent-registry';
import { AgentMessageSchema, makeMsg } from '../schemas/agent-protocol';
import { findTenantByLicense } from './tenant-db';
import { upsertAgent, touchAgentHeartbeat, setAgentOffline, findOrCreateAgentUuid } from './agent-db';
import { upsertAgentSkillStatuses } from './skill-db';
import { handleTaskResult } from './task-dispatch';

const WS_PATH = '/agent-ws';

export function attachAgentWS(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url || !req.url.startsWith(WS_PATH)) return;

    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || (req.headers['x-agent-token'] as string) || '';

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let tenant: Awaited<ReturnType<typeof findTenantByLicense>>;
    try {
      tenant = await findTenantByLicense(token);
    } catch (err) {
      console.warn('[agent-ws] DB error during license check:', err);
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!tenant) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as any).__tenantId = tenant!.id;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    // H-1 ws3: agentId 是 UUID (agents.id), displayName 是 hello string (log only)
    // 老 v1.0 Agent 发 string agentId 时自动转 UUID via findOrCreateAgentUuid
    let agentId: string | null = null;       // UUID
    let displayName: string | null = null;   // 原 hello string
    let pendingHeartbeats: Array<{ uptime: number; busy: boolean }> = []; // R5: 缓存 hello 完成前的 heartbeat
    const tenantId: string = (ws as any).__tenantId || '';

    ws.on('message', async (raw) => {
      try {
        const obj = JSON.parse(raw.toString());
        const msg = AgentMessageSchema.parse(obj);

        if (msg.type === 'hello') {
          // H-1 ws3: string display → UUID 转换（findOrCreateAgentUuid 用 ON CONFLICT 防竞态）
          displayName = msg.payload.agentId;
          try {
            const result = await findOrCreateAgentUuid({
              displayName,
              tenantId: tenantId || null,
              capabilities: msg.payload.capabilities,
              version: msg.payload.version,
            });
            agentId = result.uuid;
          } catch (e) {
            console.warn('[agent-ws] findOrCreateAgentUuid failed, fallback to display name:', e);
            agentId = displayName;
          }

          agentRegistry.register(agentId, {
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
            tenantId,
            displayName,
          }, ws, displayName);
          upsertAgent({
            tenantId,
            agentId: displayName, // upsertAgent 用 display name 作 agent_id 列（保留原 schema）
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
          }).catch((e) => console.warn('[agent-ws] upsertAgent failed:', e));
          if (msg.payload.skills?.length) {
            upsertAgentSkillStatuses(displayName, msg.payload.skills).catch(
              (e) => console.warn('[agent-ws] upsertSkillStatuses failed:', e)
            );
          }
          // R5: flush 缓存的 heartbeat
          for (const hb of pendingHeartbeats) {
            agentRegistry.heartbeat(agentId, hb);
            touchAgentHeartbeat(displayName).catch((e) => console.warn('[agent-ws] flushed heartbeat failed:', e));
          }
          pendingHeartbeats = [];
          console.log(`[agent-ws] hello: ${displayName}(${agentId}) registered`);
        } else if (msg.type === 'heartbeat') {
          if (agentId && displayName) {
            agentRegistry.heartbeat(agentId, msg.payload);
            touchAgentHeartbeat(displayName).catch((e) => console.warn('[agent-ws] heartbeat DB failed:', e));
          } else {
            // R5: hello 还没完成（async findOrCreate 在跑），缓存 heartbeat 待 flush
            pendingHeartbeats.push(msg.payload);
          }
        } else if (msg.type === 'task_progress') {
          agentRegistry.emit(msg.type, { agentId, displayName, ...msg });
        } else if (msg.type === 'task_result') {
          agentRegistry.emit(msg.type, { agentId, displayName, ...msg });
          if (msg.taskId) {
            handleTaskResult(msg.taskId, msg.payload).catch(
              (e) => console.warn('[agent-ws] handleTaskResult failed:', e)
            );
          }
        }
      } catch (err) {
        console.warn('[agent-ws] invalid message:', err);
      }
    });

    ws.on('close', () => {
      if (agentId) {
        agentRegistry.unregister(agentId);
        if (displayName) {
          setAgentOffline(displayName).catch((e) => console.warn('[agent-ws] setAgentOffline failed:', e));
        }
      }
    });
  });

  return wss;
}

export function sendToAgent(agentId: string, msg: ReturnType<typeof makeMsg>): boolean {
  const entry = agentRegistry.get(agentId);
  if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
  entry.ws.send(JSON.stringify(msg));
  return true;
}
