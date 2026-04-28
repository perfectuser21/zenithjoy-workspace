import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../services/skill-db', () => ({
  listSkills: vi.fn(),
  getAllAgentSkillStatuses: vi.fn(),
}));

import app from '../../app';
import { listSkills, getAllAgentSkillStatuses } from '../../services/skill-db';

const mockListSkills = listSkills as ReturnType<typeof vi.fn>;
const mockGetAllStatuses = getAllAgentSkillStatuses as ReturnType<typeof vi.fn>;

describe('GET /api/skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns skills with agent_statuses merged', async () => {
    mockListSkills.mockResolvedValueOnce([
      { id: '1', slug: 'kuaishou_image_publish', platform: 'kuaishou', name: '快手图文发布', active: true },
    ]);
    mockGetAllStatuses.mockResolvedValueOnce([
      { agent_id: 'agent-1', skill_slug: 'kuaishou_image_publish', status: 'ready', last_error: null, last_check: '2026-04-28' },
    ]);

    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(1);
    expect(res.body.skills[0].slug).toBe('kuaishou_image_publish');
    expect(res.body.skills[0].agent_statuses['agent-1'].status).toBe('ready');
  });

  it('returns empty skills array when DB has no data', async () => {
    mockListSkills.mockResolvedValueOnce([]);
    mockGetAllStatuses.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([]);
  });

  it('skills with no agent status get empty agent_statuses object', async () => {
    mockListSkills.mockResolvedValueOnce([
      { id: '2', slug: 'weibo_image_dryrun', platform: 'weibo', name: '微博图文发布（演练）', active: true },
    ]);
    mockGetAllStatuses.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.skills[0].agent_statuses).toEqual({});
  });
});
