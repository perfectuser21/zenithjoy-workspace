import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import {
  listSkills,
  upsertAgentSkillStatuses,
  getAgentSkillStatuses,
  getAllAgentSkillStatuses,
} from '../skill-db';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('skill-db', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('listSkills', () => {
    it('returns rows from query', async () => {
      const rows = [{ id: '1', slug: 'kuaishou_image_publish', platform: 'kuaishou' }];
      mockQuery.mockResolvedValueOnce({ rows });
      const result = await listSkills();
      expect(result).toEqual(rows);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/zenithjoy\.skills/);
      expect(sql).toMatch(/active = true/);
    });
  });

  describe('upsertAgentSkillStatuses', () => {
    it('does nothing when skills array is empty', async () => {
      await upsertAgentSkillStatuses('agent-1', []);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('inserts multiple skills in one query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await upsertAgentSkillStatuses('agent-1', [
        { slug: 'kuaishou_image_publish', status: 'ready' },
        { slug: 'weibo_image_dryrun', status: 'login_expired', error: 'session expired' },
      ]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/ON CONFLICT.*DO UPDATE/s);
      expect(params).toContain('agent-1');
      expect(params).toContain('kuaishou_image_publish');
      expect(params).toContain('ready');
      expect(params).toContain('weibo_image_dryrun');
      expect(params).toContain('login_expired');
      expect(params).toContain('session expired');
    });

    it('uses null for missing error field', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await upsertAgentSkillStatuses('agent-1', [
        { slug: 'kuaishou_image_publish', status: 'ready' },
      ]);
      const [, params] = mockQuery.mock.calls[0];
      expect(params).toContain(null);
    });
  });

  describe('getAgentSkillStatuses', () => {
    it('queries by agent_id and returns rows', async () => {
      const rows = [{ agent_id: 'a1', skill_slug: 'kuaishou_image_publish', status: 'ready' }];
      mockQuery.mockResolvedValueOnce({ rows });
      const result = await getAgentSkillStatuses('a1');
      expect(result).toEqual(rows);
      const [, params] = mockQuery.mock.calls[0];
      expect(params).toContain('a1');
    });
  });

  describe('getAllAgentSkillStatuses', () => {
    it('returns all rows without filter', async () => {
      const rows = [
        { agent_id: 'a1', skill_slug: 'sk1', status: 'ready' },
        { agent_id: 'a2', skill_slug: 'sk2', status: 'unknown' },
      ];
      mockQuery.mockResolvedValueOnce({ rows });
      const result = await getAllAgentSkillStatuses();
      expect(result).toHaveLength(2);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/agent_skill_status/);
    });
  });
});
