import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAgentStatus,
  listTasks,
  listSkills,
  createTask,
  INTERNAL_TENANT_ID,
} from '../agent.api';

describe('api/agent.api', () => {
  it('导出 INTERNAL_TENANT_ID 常量', () => {
    expect(typeof INTERNAL_TENANT_ID).toBe('string');
    expect(INTERNAL_TENANT_ID.length).toBeGreaterThan(0);
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
