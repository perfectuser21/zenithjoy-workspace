import { describe, it, expect } from 'vitest';
import { AgentMessageSchema, ServerMessageSchema } from '../agent-protocol';

describe('AgentMessageSchema', () => {
  it('parses valid hello message', () => {
    const msg = {
      v: 1, type: 'hello', msgId: 'm1', ts: Date.now(),
      payload: { agentId: 'a1', version: '0.1.0', capabilities: ['wechat'] }
    };
    expect(() => AgentMessageSchema.parse(msg)).not.toThrow();
  });

  it('rejects missing payload', () => {
    expect(() => AgentMessageSchema.parse({
      v: 1, type: 'hello', msgId: 'm1', ts: Date.now()
    })).toThrow();
  });

  it('parses task_result with ok=false + error', () => {
    const msg = {
      v: 1, type: 'task_result', msgId: 'm2', taskId: 't1', ts: Date.now(),
      payload: { ok: false, error: 'wechat api failed' }
    };
    expect(() => AgentMessageSchema.parse(msg)).not.toThrow();
  });
});

describe('ServerMessageSchema', () => {
  it('parses publish_request', () => {
    const msg = {
      v: 1, type: 'publish_request', msgId: 'm3', taskId: 't2', ts: Date.now(),
      payload: { platform: 'wechat', content: { title: 'hi', body: '<p>hi</p>' } }
    };
    expect(() => ServerMessageSchema.parse(msg)).not.toThrow();
  });
});
