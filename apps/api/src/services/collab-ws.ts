/**
 * collab-ws —— 路② 协同笔记实时协作房（Yjs over WebSocket），挂路径 `/collab-ws`
 *
 * 与 /agent-ws 完全独立（不同路径、不同鉴权、不同协议）。鉴权换成**手写 cookie 会话解析**，
 * 与 HTTP 文档端点零分叉：
 *   - 握手：auth.api.getSession({ headers: fromNodeHeaders(upgradeReq.headers) }) → memberId；
 *     再 tenant_members 真查，rows.length===1 才谈得上建房；0→拒、>1→拒（绝不取 rows[0]，A3-c）。
 *   - 每连接 doc 权校验：目标文档必须对 (orgId, memberId) 可见/可编辑，否则拒绝不建房（A3-b）。
 *   - 无会话/失效会话 → 拒绝不建房（A3-b）；建房后会话被删 → 下一写操作断连（A3-e，不静默续命）。
 *
 * 服务端 CRDT-CV（A10）：收到裸 Yjs update 后，apply 到房间 doc → runCv 白名单剥洗 → 从干净 JSON
 * 全新重建 doc → 落库 crdt_state（bytea）与 content（jsonb）。裸客户端注入的 `onerror`/`javascript:`
 * 落库两处产物均不含（crdt-cv 从干净 JSON 重建，不复用带 tombstone 的房间 doc）。
 *
 * 白名单单一实现：CV 走 ../workbench/document-schema（同 HTTP 保存路径），不另造第二份。
 */
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { fromNodeHeaders } from 'better-auth/node';
import * as Y from 'yjs';
import pool from '../db/connection';
import { auth } from '../auth';
import { getDocument } from '../workbench/document.service';
import { runCv, proseMirrorToYDoc } from '../workbench/crdt-cv';
import { isValidProseMirrorDoc } from '../workbench/document-schema';

const WS_PATH = '/collab-ws';
const PING_INTERVAL_MS = 15_000;

interface Room {
  docId: string;
  ydoc: Y.Doc;
  seeded: boolean;
  clients: Set<WebSocket>;
}

interface CollabConn {
  memberId: string;
  orgId: string;
  docId: string;
  sessionToken: string;
}

const rooms = new Map<string, Room>();

function getRoom(docId: string): Room {
  let room = rooms.get(docId);
  if (!room) {
    room = { docId, ydoc: new Y.Doc(), seeded: false, clients: new Set() };
    rooms.set(docId, room);
  }
  return room;
}

/** 房间冷启动时从 DB 载入既有状态（crdt_state 优先；否则从 content 白名单重建）。 */
async function seedRoom(room: Room): Promise<void> {
  if (room.seeded) return;
  room.seeded = true;
  try {
    const r = await pool.query('SELECT crdt_state, content FROM zenithjoy.documents WHERE id = $1', [
      room.docId,
    ]);
    if (r.rowCount === 0) return;
    const crdt = r.rows[0].crdt_state as Buffer | null;
    if (crdt && crdt.length) {
      Y.applyUpdate(room.ydoc, new Uint8Array(crdt));
      return;
    }
    const content = r.rows[0].content;
    if (isValidProseMirrorDoc(content)) {
      const seedDoc = proseMirrorToYDoc(content as { type: string; content?: Record<string, unknown>[] });
      Y.applyUpdate(room.ydoc, Y.encodeStateAsUpdate(seedDoc));
    }
  } catch (err) {
    console.warn('[collab-ws] seedRoom 失败:', (err as Error).message);
  }
}

/** 会话是否仍存活（未被删、未过期）。A3-e：删 session 后下一写操作即断连。 */
async function sessionAlive(token: string): Promise<boolean> {
  try {
    const r = await pool.query(
      'SELECT 1 FROM zenithjoy.session WHERE token = $1 AND "expiresAt" > now() LIMIT 1',
      [token]
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    // 查不动会话 → fail-closed 当作失效断连（宁可断，不静默续命）
    return false;
  }
}

function reject(socket: Socket, code = 401): void {
  try {
    socket.write(`HTTP/1.1 ${code} Unauthorized\r\n\r\n`);
    socket.destroy();
  } catch {
    /* 忽略 */
  }
}

/** 握手鉴权：解析会话 → 单 org → doc 权。任一不过 → null（拒绝不建房）。 */
async function authorize(req: IncomingMessage): Promise<CollabConn | null> {
  const url = new URL(req.url || '', 'http://x');
  const docId = url.searchParams.get('doc_id') || '';
  if (!docId) return null;

  let memberId: string | null = null;
  let sessionToken = '';
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const id = session?.user?.id;
    memberId = typeof id === 'string' && id.length > 0 ? id : null;
    sessionToken = typeof session?.session?.token === 'string' ? session.session.token : '';
  } catch {
    return null;
  }
  if (!memberId || !sessionToken) return null;

  // 单 org fail-closed：0→拒，>1→拒（绝不取 rows[0]）
  let rows: Array<{ tenant_id: string }>;
  try {
    const r = await pool.query(
      'SELECT DISTINCT tenant_id::text AS tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id = $1',
      [memberId]
    );
    rows = r.rows as Array<{ tenant_id: string }>;
  } catch {
    return null;
  }
  if (rows.length !== 1) return null;
  const orgId = rows[0].tenant_id;

  // 每连接 doc 权校验：目标文档必须本 org 可见（同 HTTP 可见性口径）
  let visible = false;
  try {
    visible = (await getDocument(orgId, memberId, docId)) !== null;
  } catch {
    return null; // 可见性解析失败 → fail-closed 拒
  }
  if (!visible) return null;

  return { memberId, orgId, docId, sessionToken };
}

/** apply → CV → 落库；返回落库后的 crdt_state（用于广播基线）。 */
async function applyAndPersist(room: Room, update: Uint8Array): Promise<void> {
  Y.applyUpdate(room.ydoc, update);
  const { content, crdtState } = runCv(room.ydoc);
  await pool.query(
    'UPDATE zenithjoy.documents SET crdt_state = $1, content = $2::jsonb, updated_at = NOW() WHERE id = $3',
    [crdtState, JSON.stringify(content), room.docId]
  );
}

export function attachCollabWS(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // 协议级 ping + 会话存活复核：死连接 terminate；会话已失效的连接主动断开（A3-e 兜底）。
  const pingTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      const ext = ws as WebSocket & { _isAlive?: boolean; _conn?: CollabConn };
      if (ext._isAlive === false) {
        ws.terminate();
        return;
      }
      ext._isAlive = false;
      try {
        ws.ping();
      } catch {
        /* 忽略 */
      }
      if (ext._conn) {
        sessionAlive(ext._conn.sessionToken).then((alive) => {
          if (!alive && ws.readyState === ws.OPEN) ws.close(4401, 'session expired');
        });
      }
    });
  }, PING_INTERVAL_MS);
  pingTimer.unref?.();
  wss.on('close', () => clearInterval(pingTimer));

  server.on('upgrade', async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!req.url || !req.url.startsWith(WS_PATH)) return; // 不是本路径，交给其它 upgrade 监听器

    let conn: CollabConn | null;
    try {
      conn = await authorize(req);
    } catch {
      reject(socket);
      return;
    }
    if (!conn) {
      reject(socket);
      return;
    }

    wss.handleUpgrade(req, socket, head, async (ws) => {
      const ext = ws as WebSocket & { _isAlive?: boolean; _conn?: CollabConn };
      ext._isAlive = true;
      ext._conn = conn!;
      ws.on('pong', () => {
        ext._isAlive = true;
      });

      const room = getRoom(conn!.docId);
      await seedRoom(room);
      room.clients.add(ws);

      // 下发当前房间状态给新加入者（真浏览器据此渲染既有正文）
      try {
        const state = Y.encodeStateAsUpdate(room.ydoc);
        if (state.length) ws.send(state);
      } catch {
        /* 忽略 */
      }

      ws.on('message', async (raw: Buffer) => {
        // A3-e：每次写操作先复核会话存活，失效即断，不静默续命
        if (!(await sessionAlive(ext._conn!.sessionToken))) {
          try {
            ws.close(4401, 'session expired');
          } catch {
            /* 忽略 */
          }
          return;
        }
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as unknown as ArrayBuffer);
        const update = new Uint8Array(buf);
        try {
          await applyAndPersist(room, update);
        } catch (err) {
          console.warn('[collab-ws] applyAndPersist 失败:', (err as Error).message);
          return;
        }
        // 广播给房间内其它客户端（实时字符级合并）
        for (const client of room.clients) {
          if (client !== ws && client.readyState === client.OPEN) {
            try {
              client.send(update, { binary: true });
            } catch {
              /* 忽略 */
            }
          }
        }
      });

      ws.on('close', () => {
        room.clients.delete(ws);
        if (room.clients.size === 0) rooms.delete(room.docId);
      });
      ws.on('error', () => {
        room.clients.delete(ws);
      });
    });
  });

  return wss;
}
