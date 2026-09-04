/**
 * OpenClaw 信号桥·件2 — cmd / cmd_result 协议分支
 *
 * 不加 cmd_result 分支 = zod discriminatedUnion 直接丢弃上行（Explore 实证），
 * 所以这里 schema 双向 parse 是硬验收项。
 * 设备端字段来源：CommandProtocol.buildResult（inReplyTo/ok/errorCode/foregroundPkg/data），
 * foregroundPkg 可能为 null（设备拿不到前台包名时）。
 */
import { describe, it, expect } from 'vitest';
import { AgentMessageSchema, ServerMessageSchema } from '../agent-protocol';

describe('ServerMessageSchema cmd 分支', () => {
  it('parses cmd 下行（action + 宽松透传 args）', () => {
    const msg = {
      v: 1, type: 'cmd', msgId: 'cmd-1', ts: Date.now(),
      payload: { action: 'tap', x: 100, y: 200 },
    };
    const parsed = ServerMessageSchema.parse(msg);
    expect(parsed.type).toBe('cmd');
    // 宽松 record：args 必须原样保留（设备端 CommandProtocol.parse 直接读 payload["x"]）
    expect((parsed.payload as Record<string, unknown>).x).toBe(100);
    expect((parsed.payload as Record<string, unknown>).y).toBe(200);
  });

  it('cmd 缺 action → 拒绝', () => {
    expect(() => ServerMessageSchema.parse({
      v: 1, type: 'cmd', msgId: 'cmd-2', ts: Date.now(), payload: { x: 1 },
    })).toThrow();
  });
});

describe('AgentMessageSchema cmd_result 分支', () => {
  it('parses 完整 cmd_result（inReplyTo/ok/errorCode/foregroundPkg/data）', () => {
    const msg = {
      v: 1, type: 'cmd_result', msgId: 'new-envelope-id', ts: Date.now(),
      payload: {
        inReplyTo: 'cmd-1', ok: false, errorCode: 'COORD_OUT_OF_BOUNDS',
        foregroundPkg: 'com.ss.android.ugc.aweme', data: { detail: '(9999,9999) vs 1080x2400' },
      },
    };
    const parsed = AgentMessageSchema.parse(msg);
    expect(parsed.type).toBe('cmd_result');
    if (parsed.type === 'cmd_result') {
      expect(parsed.payload.inReplyTo).toBe('cmd-1');
      expect(parsed.payload.ok).toBe(false);
      expect(parsed.payload.errorCode).toBe('COORD_OUT_OF_BOUNDS');
    }
  });

  it('parses foregroundPkg=null（设备拿不到前台包名）', () => {
    const msg = {
      v: 1, type: 'cmd_result', msgId: 'm2', ts: Date.now(),
      payload: { inReplyTo: 'cmd-1', ok: true, foregroundPkg: null },
    };
    expect(() => AgentMessageSchema.parse(msg)).not.toThrow();
  });

  it('payload 宽松：未知新增字段不拒（向前兼容设备端加字段）', () => {
    const msg = {
      v: 1, type: 'cmd_result', msgId: 'm3', ts: Date.now(),
      payload: { inReplyTo: 'cmd-1', ok: true, foregroundPkg: 'x', futureField: 42 },
    };
    const parsed = AgentMessageSchema.parse(msg);
    if (parsed.type === 'cmd_result') {
      expect((parsed.payload as Record<string, unknown>).futureField).toBe(42);
    }
  });
});
