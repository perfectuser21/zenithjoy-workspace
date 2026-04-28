import { describe, it, expect, beforeEach } from 'vitest';
import type { WebSocket } from 'ws';
import { AgentRegistry } from '../agent-registry';

// Test-only loose ws stub — only the methods touched by registry are needed.
type WsStub = Pick<WebSocket, 'close'> & Partial<WebSocket>;
const stubWs = (overrides: Partial<WsStub> = {}): WebSocket =>
  ({ close: () => {}, ...overrides }) as unknown as WebSocket;

describe('AgentRegistry', () => {
  let reg: AgentRegistry;
  beforeEach(() => { reg = new AgentRegistry(); });

  it('registers and lists agents', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0', tenantId: 'tenant-1' }, stubWs());
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].agentId).toBe('a1');
  });

  it('unregisters agent', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0', tenantId: 'tenant-1' }, stubWs());
    reg.unregister('a1');
    expect(reg.list()).toHaveLength(0);
  });

  it('updates heartbeat ts', async () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0', tenantId: 'tenant-1' }, stubWs());
    const before = reg.list()[0].lastHeartbeat;
    await new Promise(r => setTimeout(r, 10));
    reg.heartbeat('a1', { uptime: 100, busy: false });
    expect(reg.list()[0].lastHeartbeat).toBeGreaterThan(before);
  });

  it('replaces existing agent on duplicate register (last-write-wins)', () => {
    const ws1 = stubWs();
    const ws2 = stubWs();
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0', tenantId: 'tenant-1' }, ws1);
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0', tenantId: 'tenant-1' }, ws2);
    expect(reg.list()).toHaveLength(1);
  });
});
