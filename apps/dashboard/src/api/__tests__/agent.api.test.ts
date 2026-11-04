import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAgentStatus,
  listTasks,
  listSkills,
  createTask,
} from '../agent.api';

describe('api/agent.api', () => {
  it('task list and creation use cookie identity without an internal tenant override', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await listTasks(); await createTask('fixture-skill', { title: 'fixture' });
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agent/tasks', { credentials: 'include' });
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agent/tasks', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill: 'fixture-skill', params: { title: 'fixture' } }) });
    } finally { vi.unstubAllGlobals(); }
  });

  it('导出 getAgentStatus 函数', () => {
    expect(typeof getAgentStatus).toBe('function');
  });

  it('导出 listTasks 函数', () => {
    expect(typeof listTasks).toBe('function');
  });

  it('导出 listSkills 函数', () => {
    expect(typeof listSkills).toBe('function');
  });

  it('导出 createTask 函数', () => {
    expect(typeof createTask).toBe('function');
  });

  describe('listSkills', () => {
    const fetchMock = vi.fn();
    beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('calls /api/skills and returns response JSON', async () => {
      const mockData = { skills: [{ slug: 'kuaishou_image_publish', platform: 'kuaishou' }] };
      fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockData) });
      const result = await listSkills();
      expect(result).toEqual(mockData);
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/skills'));
    });

    it('throws when response is not ok', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false });
      await expect(listSkills()).rejects.toThrow('failed');
    });
  });
});
