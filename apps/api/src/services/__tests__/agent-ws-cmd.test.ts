/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OpenClaw 信号桥·件2 — agent-ws 接线：
 *  1. message 分发链加 cmd_result 分支 → commandBridge.handleCmdResult(agentId, payload)
 *  2. close handler 把 ws 传给 unregister（配合 registry 竞态修复）：
 *     只有 unregister 真删（返回 true）才 setAgentOffline，旧 socket 迟到 close 不误标。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const make = () => {
    const handlers: Record<string, Handler[]> = {};
    return {
      handlers,
      clients: new Set<unknown>(),
      on(ev: string, fn: Handler) { (handlers[ev] ||= []).push(fn); },
      emit(ev: string, ...args: unknown[]) { (handlers[ev] || []).forEach((f) => f(...args)); },
    };
  };
  return { make, fakeWss: make() };
});

vi.mock('ws', () => ({ WebSocketServer: vi.fn(() => holder.fakeWss), WebSocket: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../agent-registry', () => ({
  agentRegistry: {
    get: vi.fn(), register: vi.fn(), heartbeat: vi.fn(),
    unregister: vi.fn(() => true), emit: vi.fn(), on: vi.fn(),
  },
}));
vi.mock('../agent-db', () => ({
  upsertAgent: vi.fn(async () => ({})),
  touchAgentHeartbeat: vi.fn(async () => ({})),
  setAgentOffline: vi.fn(async () => ({})),
  findOrCreateAgentUuid: vi.fn(),
}));
vi.mock('../skill-db', () => ({ upsertAgentSkillStatuses: vi.fn(async () => ({})) }));
vi.mock('../task-dispatch', () => ({ handleTaskResult: vi.fn(async () => ({})) }));
vi.mock('../walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../license.service', () => ({ verifyWsToken: vi.fn() }));
vi.mock('../command-bridge', () => ({ commandBridge: { handleCmdResult: vi.fn() } }));

import { attachAgentWS } from '../agent-ws';
import { agentRegistry } from '../agent-registry';
import { findOrCreateAgentUuid, setAgentOffline } from '../agent-db';
import { commandBridge } from '../command-bridge';

const AID = '44444444-4444-4444-8444-444444444444';
const tick = () => new Promise((r) => setImmediate(r));

function makeFakeWs() {
  type Handler = (...args: unknown[]) => void;
  const handlers: Record<string, Handler[]> = {};
  return {
    on(ev: string, fn: Handler) { (handlers[ev] ||= []).push(fn); },
    emit(ev: string, ...args: unknown[]) { (handlers[ev] || []).forEach((f) => f(...args)); },
    ping: vi.fn(), send: vi.fn(), terminate: vi.fn(), close: vi.fn(),
  };
}

async function connectAndHello() {
  const server = { on: vi.fn() };
  attachAgentWS(server as any);
  const ws = makeFakeWs();
  holder.fakeWss.emit('connection', ws);
  (findOrCreateAgentUuid as any).mockResolvedValue({ uuid: AID, displayName: 'dev-1' });
  ws.emit('message', Buffer.from(JSON.stringify({
    v: 1, type: 'hello', msgId: 'h1', ts: Date.now(),
    payload: { agentId: 'dev-1', version: '2.1.48', capabilities: ['android'] },
  })));
  await tick();
  return ws;
}

beforeEach(() => {
  vi.clearAllMocks();
  (agentRegistry.unregister as any).mockReturnValue(true);
  holder.fakeWss = holder.make();
});

describe('agent-ws cmd_result 分支', () => {
  it('cmd_result 上行 → commandBridge.handleCmdResult(agentId, payload)', async () => {
    const ws = await connectAndHello();
    ws.emit('message', Buffer.from(JSON.stringify({
      v: 1, type: 'cmd_result', msgId: 'fresh-envelope', ts: Date.now(),
      payload: { inReplyTo: 'cmd-1', ok: true, foregroundPkg: 'com.x' },
    })));
    await tick();
    expect(commandBridge.handleCmdResult).toHaveBeenCalledWith(
      AID, expect.objectContaining({ inReplyTo: 'cmd-1', ok: true })
    );
  });
});

describe('agent-ws close handler 竞态修复', () => {
  it('close 把自己的 ws 传给 unregister；真删（true）才 setAgentOffline', async () => {
    const ws = await connectAndHello();
    (agentRegistry.unregister as any).mockReturnValue(true);
    ws.emit('close');
    expect(agentRegistry.unregister).toHaveBeenCalledWith(AID, ws);
    await tick();
    expect(setAgentOffline).toHaveBeenCalledWith('dev-1');
  });

  it('unregister 返回 false（entry 已被新连接顶替）→ 不 setAgentOffline', async () => {
    const ws = await connectAndHello();
    (agentRegistry.unregister as any).mockReturnValue(false);
    ws.emit('close');
    await tick();
    expect(setAgentOffline).not.toHaveBeenCalled();
  });
});
