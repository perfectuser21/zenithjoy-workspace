import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import * as Y from 'yjs';
import { proseMirrorToYDoc } from '../workbench/crdt-cv';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const sql = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query: sql.query } }));
vi.mock('../auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'seed-race-member' }, session: { token: 'seed-race-session' } }) } } }));
vi.mock('../workbench/document.service', () => ({ getDocument: async () => ({ id: 'visible-test-document' }) }));
import { attachCollabWS } from './collab-ws';

// 协议回归：真实HTTP/WS帧、真实Yjs与服务端CV；SQL/授权仅作隔离fixture，真PG安全合同仍保留。
let seedGate: ReturnType<typeof deferred<void>>;
let seedStarted: ReturnType<typeof deferred<void>>;
let persisted: ReturnType<typeof deferred<void>>;
let storedText: string;
let writes: Buffer[];
let server: Server | undefined;
let wss: WebSocketServer | undefined;
const clients: WebSocket[] = [];

beforeEach(() => {
  seedGate = deferred(); seedStarted = deferred(); persisted = deferred(); storedText = ''; writes = [];
  sql.query.mockReset().mockImplementation(async (statement: string, parameters?: unknown[]) => {
    if (statement.includes('SELECT DISTINCT tenant_id')) return { rows: [{ tenant_id: 'seed-race-org' }], rowCount: 1 };
    if (statement.includes('SELECT crdt_state, content')) {
      seedStarted.resolve(); await seedGate.promise;
      return { rows: [{ crdt_state: null, content: { type: 'doc', content: storedText ? [{ type: 'paragraph', content: [{ type: 'text', text: storedText }] }] : [] } }], rowCount: 1 };
    }
    if (statement.includes('SELECT 1 FROM zenithjoy.session')) return { rows: [{ alive: true }], rowCount: 1 };
    if (statement.startsWith('UPDATE zenithjoy.documents')) {
      const bytes = parameters?.[0];
      if (!Buffer.isBuffer(bytes)) throw new Error('CV产物必须为实际二进制状态');
      writes.push(bytes); persisted.resolve(); return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected regression query: ${statement}`);
  });
});
afterEach(async () => {
  seedGate.resolve();
  for (const ws of clients.splice(0)) ws.terminate();
  if (wss) { for (const ws of wss.clients) ws.terminate(); await new Promise<void>(done => wss!.close(() => done())); wss = undefined; }
  if (server) { await new Promise<void>(done => server!.close(() => done())); server = undefined; }
});
async function start() {
  server = createServer(); wss = attachCollabWS(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/collab-ws?doc_id=${randomUUID()}`;
}
function bytes(raw: RawData): Uint8Array {
  return new Uint8Array(Buffer.isBuffer(raw) ? raw : raw instanceof ArrayBuffer ? Buffer.from(raw) : Buffer.concat(raw));
}
function text(raw: Uint8Array) {
  const doc = new Y.Doc(); Y.applyUpdate(doc, raw);
  const value = doc.getXmlFragment('default').toString(); doc.destroy(); return value;
}
async function connect(url: string) {
  const ws = new WebSocket(url); clients.push(ws);
  const firstFrame = deferred<Uint8Array>(); ws.once('message', raw => firstFrame.resolve(bytes(raw)));
  await once(ws, 'open'); return { ws, firstFrame: firstFrame.promise };
}
async function deliver(ws: WebSocket, payload: Uint8Array) {
  const peer = [...wss!.clients][0];
  // 单独的传输probe只确认帧到达，不能为业务保存/广播帧，故不会掩盖监听缺口。
  if (!peer) throw new Error('真实server peer不存在');
  const arrived = once(peer, 'message'); ws.send(payload); await arrived;
}

describe('协同房冷seed与首帧确定性回归', () => {
  it('保留挂载合同：返回noServer WebSocketServer实例', async () => {
    await start(); expect(wss).toBeInstanceOf(WebSocketServer); expect(wss!.options.noServer).toBe(true); expect(wss!.clients).toBeInstanceOf(Set);
  });
  it('保留挂载合同：在HTTP server登记upgrade监听', async () => {
    await start(); expect(server!.listenerCount('upgrade')).toBeGreaterThanOrEqual(1);
  });
  it('seed仍等待时已到达的完整离线首帧必须持久化并被后加入者读到', async () => {
    const url = await start(), a = await connect(url); await seedStarted.promise;
    const offline = proseMirrorToYDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '首帧离线内容不丢失' }] }] });
    await deliver(a.ws, Y.encodeStateAsUpdate(offline));
    seedGate.resolve(); await a.firstFrame;
    // 已知seed完成后的空帧作为事件屏障，正常业务处理必须把之前首帧包含在CV状态里。
    const empty = new Y.Doc(); await deliver(a.ws, Y.encodeStateAsUpdate(empty)); await persisted.promise;
    const b = await connect(url);
    expect(text(await b.firstFrame)).toContain('首帧离线内容不丢失');
    expect(writes.some(blob => text(new Uint8Array(blob)).includes('首帧离线内容不丢失'))).toBe(true);
    offline.destroy(); empty.destroy();
  });
  it('首帧已接收但seed未完成时断连，重连者不能覆盖尚在队列的正文', async () => {
    const url = await start(), a = await connect(url); await seedStarted.promise;
    const offline = proseMirrorToYDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '断连前已接收正文' }] }] });
    await deliver(a.ws, Y.encodeStateAsUpdate(offline));
    const peer = [...wss!.clients][0], closed = once(peer, 'close'); a.ws.terminate(); await closed;
    const b = await connect(url); seedGate.resolve(); await b.firstFrame; await persisted.promise;
    // 等旧帧完成CV写入，再用新连接的空更新作为第二次持久化屏障，检查它不能抹掉已接收正文。
    persisted = deferred(); const empty = new Y.Doc();
    const bPeer = [...wss!.clients][0], arrived = once(bPeer, 'message'); b.ws.send(Y.encodeStateAsUpdate(empty)); await arrived; await persisted.promise;
    expect(text(new Uint8Array(writes[writes.length - 1]))).toContain('断连前已接收正文');
    const reader = await connect(url); expect(text(await reader.firstFrame)).toContain('断连前已接收正文');
    offline.destroy(); empty.destroy();
  });
  it('seed等待期间连接关闭后，下一连接须重新读取数据库而非复用悬空房间', async () => {
    storedText = '重连数据库基线';
    const url = await start(), first = await connect(url); await seedStarted.promise;
    const peer = [...wss!.clients][0], closed = once(peer, 'close'); first.ws.terminate(); await closed;
    seedGate.resolve();
    const reopened = await connect(url);
    expect(text(await reopened.firstFrame)).toContain(storedText);
    expect(sql.query.mock.calls.filter(([statement]) => statement.includes('SELECT crdt_state, content'))).toHaveLength(2);
  });
  it('同房两个连接共享未完成seed，第二人不能获得空的旧基线', async () => {
    storedText = '既有数据库正文';
    const url = await start(), a = await connect(url); await seedStarted.promise;
    const b = await connect(url); seedGate.resolve();
    expect(text(await a.firstFrame)).toContain(storedText);
    expect(text(await b.firstFrame)).toContain(storedText);
    expect(sql.query.mock.calls.filter(([statement]) => statement.includes('SELECT crdt_state, content'))).toHaveLength(1);
  });
});
