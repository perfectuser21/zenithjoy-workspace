import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../agent-registry';

describe('AgentRegistry', () => {
  let reg: AgentRegistry;
  beforeEach(() => { reg = new AgentRegistry(); });

  it('registers and lists agents', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, {} as any);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].agentId).toBe('a1');
  });

  it('unregisters agent', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, {} as any);
    reg.unregister('a1');
    expect(reg.list()).toHaveLength(0);
  });

  it('updates heartbeat ts', async () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, {} as any);
    const before = reg.list()[0].lastHeartbeat;
    await new Promise(r => setTimeout(r, 10));
    reg.heartbeat('a1', { uptime: 100, busy: false });
    expect(reg.list()[0].lastHeartbeat).toBeGreaterThan(before);
  });

  it('replaces existing agent on duplicate register (last-write-wins)', () => {
    const ws1 = { close: () => {} } as any;
    const ws2 = {} as any;
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, ws1);
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, ws2);
    expect(reg.list()).toHaveLength(1);
  });
});
