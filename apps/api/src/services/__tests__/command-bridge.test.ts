/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OpenClaw 信号桥·件2 — CommandBridge（pending map correlation 桥）
 *
 * 契约硬语义（prep-prd）：
 *  - 每设备同时 1 条在途，占位在任何 await 之前同步完成 → 第二并发 DEVICE_BUSY
 *  - sendToAgent false → 立即释放占位并抛 NOT_CONNECTED（不白等 35s）
 *  - resolve / timeout 都先 delete pending 再动作
 *  - 回执来源校验：fromAgentId !== pending.agentId → 丢弃告警，不 resolve
 *  - registry unregister 事件 → 该 agent 全部 pending 立即 AGENT_DISCONNECTED
 *  - timeoutMs clamp [3000, 35000]
 *  - 迟到回执（pending 已删）→ 只 UPDATE log 不 INSERT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));
// command-bridge 默认单例接线 sendToAgent（真模块拖 ws/db 依赖链），测试全部走注入构造
vi.mock('../agent-ws', () => ({ sendToAgent: vi.fn() }));

import pool from '../../db/connection';
import {
  CommandBridge, CommandBridgeError, clampTimeoutMs,
  TIMEOUT_MIN_MS, TIMEOUT_MAX_MS,
} from '../command-bridge';

const AID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function makeBridge(sendOk = true) {
  const registry = new EventEmitter();
  const send = vi.fn(() => sendOk);
  const bridge = new CommandBridge(send as any, registry as any);
  return { bridge, send, registry };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('clampTimeoutMs', () => {
  it('缺省 → 上限 35000', () => expect(clampTimeoutMs(undefined)).toBe(TIMEOUT_MAX_MS));
  it('过小 clamp 到 3000', () => expect(clampTimeoutMs(100)).toBe(TIMEOUT_MIN_MS));
  it('过大 clamp 到 35000', () => expect(clampTimeoutMs(600000)).toBe(TIMEOUT_MAX_MS));
  it('区间内原样', () => expect(clampTimeoutMs(5000)).toBe(5000));
});

describe('dispatchAndWait', () => {
  it('正常回执 → resolve 透传 payload，占位释放', async () => {
    const { bridge, send } = makeBridge();
    const p = bridge.dispatchAndWait(AID, 'tap', { x: 1, y: 2 }, 5000, 'msg-1');
    // 下发的信封：顶层 msgId = 指定 id，payload = {action, ...args}
    expect(send).toHaveBeenCalledTimes(1);
    const sent = (send.mock.calls[0] as any[])[1];
    expect(sent.msgId).toBe('msg-1');
    expect(sent.type).toBe('cmd');
    expect(sent.payload).toEqual({ action: 'tap', x: 1, y: 2 });

    const handled = bridge.handleCmdResult(AID, { inReplyTo: 'msg-1', ok: true, foregroundPkg: 'com.x' });
    expect(handled).toBe(true);
    await expect(p).resolves.toEqual({ inReplyTo: 'msg-1', ok: true, foregroundPkg: 'com.x' });
    // 占位已释放：同设备可再次下发
    const p2 = bridge.dispatchAndWait(AID, 'key', { name: 'back' }, 5000, 'msg-2');
    bridge.handleCmdResult(AID, { inReplyTo: 'msg-2', ok: true });
    await expect(p2).resolves.toMatchObject({ ok: true });
  });

  it('sendToAgent false → 抛 NOT_CONNECTED 且立即释放占位', async () => {
    const { bridge, send } = makeBridge(false);
    await expect(bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'm1'))
      .rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    // 占位没有泄漏：第二次还能进到 send（而不是 DEVICE_BUSY）
    await expect(bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'm2'))
      .rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('每设备 1 在途：第二并发同步吃 DEVICE_BUSY，send 只调一次', async () => {
    const { bridge, send } = makeBridge();
    const p1 = bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'm1');
    await expect(bridge.dispatchAndWait(AID, 'swipe', {}, 5000, 'm2'))
      .rejects.toMatchObject({ code: 'DEVICE_BUSY' });
    expect(send).toHaveBeenCalledTimes(1);
    bridge.handleCmdResult(AID, { inReplyTo: 'm1', ok: true });
    await p1;
  });

  it('不同设备互不阻塞', async () => {
    const { bridge } = makeBridge();
    const p1 = bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'm1');
    const p2 = bridge.dispatchAndWait(OTHER, 'tap', {}, 5000, 'm2');
    bridge.handleCmdResult(AID, { inReplyTo: 'm1', ok: true });
    bridge.handleCmdResult(OTHER, { inReplyTo: 'm2', ok: false, errorCode: 'SERVICE_NOT_READY' });
    await expect(p1).resolves.toMatchObject({ ok: true });
    await expect(p2).resolves.toMatchObject({ ok: false });
  });

  it('超时 → DEVICE_TIMEOUT，先删 pending（迟到回执返回 false）', async () => {
    vi.useFakeTimers();
    const { bridge } = makeBridge();
    const p = bridge.dispatchAndWait(AID, 'screenshot', {}, 3000, 'm1');
    const assertion = expect(p).rejects.toMatchObject({ code: 'DEVICE_TIMEOUT' });
    vi.advanceTimersByTime(3001);
    await assertion;
    // pending 已删 → 迟到回执不 resolve
    expect(bridge.handleCmdResult(AID, { inReplyTo: 'm1', ok: true })).toBe(false);
    // 超时后占位已释放
    const p2 = bridge.dispatchAndWait(AID, 'tap', {}, 3000, 'm2');
    bridge.handleCmdResult(AID, { inReplyTo: 'm2', ok: true });
    await expect(p2).resolves.toMatchObject({ ok: true });
  });

  it('回执来源 agentId 不符 → 丢弃不 resolve，原 pending 仍在', async () => {
    const { bridge } = makeBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'm1');
    expect(bridge.handleCmdResult(OTHER, { inReplyTo: 'm1', ok: true })).toBe(false);
    expect(warn).toHaveBeenCalled();
    // 正主回执仍能 resolve
    expect(bridge.handleCmdResult(AID, { inReplyTo: 'm1', ok: true })).toBe(true);
    await expect(p).resolves.toMatchObject({ ok: true });
    warn.mockRestore();
  });

  it('registry unregister 事件 → 该设备全部 pending 立即 AGENT_DISCONNECTED', async () => {
    const { bridge, registry } = makeBridge();
    const p = bridge.dispatchAndWait(AID, 'tap', {}, 35000, 'm1');
    const pOther = bridge.dispatchAndWait(OTHER, 'tap', {}, 5000, 'm2');
    registry.emit('unregister', { agentId: AID });
    await expect(p).rejects.toMatchObject({ code: 'AGENT_DISCONNECTED' });
    // 其他设备不受影响
    bridge.handleCmdResult(OTHER, { inReplyTo: 'm2', ok: true });
    await expect(pOther).resolves.toMatchObject({ ok: true });
    // 掉线后占位释放：同设备可再次下发（不抛 DEVICE_BUSY）
    const p3 = bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'm3');
    bridge.handleCmdResult(AID, { inReplyTo: 'm3', ok: true });
    await expect(p3).resolves.toMatchObject({ ok: true });
  });

  it('迟到回执（无 pending）→ 只 UPDATE log 不 INSERT', async () => {
    const { bridge } = makeBridge();
    (pool.query as any).mockResolvedValue({ rows: [], rowCount: 0 });
    expect(bridge.handleCmdResult(AID, { inReplyTo: 'ghost-msg', ok: true })).toBe(false);
    await vi.waitFor(() => expect(pool.query).toHaveBeenCalled());
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/UPDATE\s+zenithjoy\.device_command_log/i);
    expect(sql).not.toMatch(/INSERT/i);
  });

  it('迟到回执 UPDATE 带来源 agent_id 过滤（I-2：防伪造来源改写别台设备审计行）', async () => {
    const { bridge } = makeBridge();
    (pool.query as any).mockResolvedValue({ rows: [], rowCount: 0 });
    bridge.handleCmdResult(AID, { inReplyTo: 'ghost-msg', ok: true });
    await vi.waitFor(() => expect(pool.query).toHaveBeenCalled());
    const [sql, params] = (pool.query as any).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/AND\s+agent_id\s*=/i);
    expect(params).toContain(AID);
  });

  it('迟到回执来源 agentId 为空（hello 前）→ 不写审计（I-2）', async () => {
    const { bridge } = makeBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(bridge.handleCmdResult(null, { inReplyTo: 'ghost-msg', ok: true })).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(pool.query).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('跨 agent 撞同 msgId（在途）→ 第二个 DEVICE_BUSY，不覆盖第一个 pending（I-1 纵深防线）', async () => {
    const { bridge, send } = makeBridge();
    const p1 = bridge.dispatchAndWait(AID, 'tap', {}, 5000, 'shared-key');
    await expect(bridge.dispatchAndWait(OTHER, 'tap', {}, 5000, 'shared-key'))
      .rejects.toMatchObject({ code: 'DEVICE_BUSY' });
    expect(send).toHaveBeenCalledTimes(1); // 第二个没下发
    // 第一个 pending 未被覆盖，正主回执照常 resolve
    expect(bridge.handleCmdResult(AID, { inReplyTo: 'shared-key', ok: true })).toBe(true);
    await expect(p1).resolves.toMatchObject({ ok: true });
    // OTHER 的占位没有被误占：它还能正常下发
    const p2 = bridge.dispatchAndWait(OTHER, 'tap', {}, 5000, 'other-key');
    bridge.handleCmdResult(OTHER, { inReplyTo: 'other-key', ok: true });
    await expect(p2).resolves.toMatchObject({ ok: true });
  });

  it('CommandBridgeError 携带 code', () => {
    const e = new CommandBridgeError('DEVICE_BUSY', 'busy');
    expect(e.code).toBe('DEVICE_BUSY');
    expect(e).toBeInstanceOf(Error);
  });
});
