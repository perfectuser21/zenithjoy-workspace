import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { upsertAgent, touchAgentHeartbeat, setAgentOffline } from '../agent-db';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('agent-db', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('upsertAgent', () => {
    it('calls INSERT ... ON CONFLICT UPDATE with correct params', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await upsertAgent({ tenantId: 'tid', agentId: 'aid', capabilities: ['wechat'], version: '1.0.0' });
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/ON CONFLICT.*DO UPDATE/s);
      expect(params).toContain('tid');
      expect(params).toContain('aid');
    });
  });

  describe('touchAgentHeartbeat', () => {
    it('updates last_seen for the given agentId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await touchAgentHeartbeat('my-agent');
      const [, params] = mockQuery.mock.calls[0];
      expect(params).toContain('my-agent');
    });
  });

  describe('setAgentOffline', () => {
    it('sets status offline for the given agentId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await setAgentOffline('my-agent');
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/offline/);
      expect(params).toContain('my-agent');
    });
  });
});
