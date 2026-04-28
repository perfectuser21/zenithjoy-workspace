import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { agentRegistry } from './agent-registry';
import { AgentMessageSchema, makeMsg } from '../schemas/agent-protocol';
import { findTenantByLicense } from './tenant-db';
import { upsertAgent, touchAgentHeartbeat, setAgentOffline } from './agent-db';
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
    let agentId: string | null = null;
    const tenantId: string = (ws as any).__tenantId || '';

    ws.on('message', (raw) => {
      try {
        const obj = JSON.parse(raw.toString());
        const msg = AgentMessageSchema.parse(obj);

        if (msg.type === 'hello') {
          agentId = msg.payload.agentId;
          agentRegistry.register(agentId, {
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
            tenantId,
          }, ws);
          upsertAgent({
            tenantId,
            agentId,
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
          }).catch((e) => console.warn('[agent-ws] upsertAgent failed:', e));
        } else if (msg.type === 'heartbeat') {
          if (agentId) {
            agentRegistry.heartbeat(agentId, msg.payload);
            touchAgentHeartbeat(agentId).catch((e) => console.warn('[agent-ws] heartbeat DB failed:', e));
          }
        } else if (msg.type === 'task_progress') {
          agentRegistry.emit(msg.type, { agentId, ...msg });
        } else if (msg.type === 'task_result') {
          agentRegistry.emit(msg.type, { agentId, ...msg });
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
        setAgentOffline(agentId).catch((e) => console.warn('[agent-ws] setAgentOffline failed:', e));
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
