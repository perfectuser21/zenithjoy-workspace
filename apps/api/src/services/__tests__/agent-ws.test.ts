import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('ws', () => ({
  WebSocketServer: vi.fn(),
  WebSocket: vi.fn(),
}));
vi.mock('../agent-registry', () => ({
  agentRegistry: { get: vi.fn(), register: vi.fn(), heartbeat: vi.fn(), unregister: vi.fn(), emit: vi.fn() },
}));
vi.mock('../tenant-db', () => ({ findTenantByLicense: vi.fn() }));
vi.mock('../agent-db', () => ({
  upsertAgent: vi.fn(),
  touchAgentHeartbeat: vi.fn(),
  setAgentOffline: vi.fn(),
}));
vi.mock('../skill-db', () => ({
  upsertAgentSkillStatuses: vi.fn(),
}));
vi.mock('../task-dispatch', () => ({ handleTaskResult: vi.fn() }));

import { sendToAgent } from '../agent-ws';
import { agentRegistry } from '../agent-registry';

describe('agent-ws', () => {
  describe('sendToAgent', () => {
    it('returns false when agent not found in registry', () => {
      (agentRegistry.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
      expect(sendToAgent('missing-agent', {} as any)).toBe(false);
    });

    it('returns false when ws is not OPEN', () => {
      (agentRegistry.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        ws: { readyState: 0, OPEN: 1, send: vi.fn() },
      });
      expect(sendToAgent('agent-1', {} as any)).toBe(false);
    });

    it('sends JSON and returns true when ws is OPEN', () => {
      const mockSend = vi.fn();
      (agentRegistry.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        ws: { readyState: 1, OPEN: 1, send: mockSend },
      });
      const msg = { type: 'task_cancel', payload: { reason: 'test' } } as any;
      expect(sendToAgent('agent-1', msg)).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(JSON.stringify(msg));
    });
  });
});
