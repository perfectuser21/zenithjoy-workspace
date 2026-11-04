/**
 * AI Video Service Tests
 *
 * Note: These are unit tests that mock the database.
 * Integration tests with real database are in DoD manual testing checklist.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
const { query, createVideo, getStatus } = vi.hoisted(() => ({ query: vi.fn(), createVideo: vi.fn(), getStatus: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query } }));
vi.mock('../../clients/toapi.client', () => ({ ToAPIClient: class {
  createVideoGeneration = createVideo;
  getTaskStatus = getStatus;
} }));
import { AiVideoService, type CreateAiVideoParams } from '../ai-video.service';
import pool from '../../db/connection';

// Current /api/ai-video consumes this service. DB and paid provider are isolated boundaries.
describe('AiVideoService', () => {
  let service: AiVideoService;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new AiVideoService();
    mockQuery = pool.query as ReturnType<typeof vi.fn>;
    mockQuery.mockReset();
    createVideo.mockReset().mockResolvedValue({ id: "task-123", status: "queued", progress: 0 });
    getStatus.mockReset();
  });

  describe('createGeneration', () => {
    it('should create a new video generation task', async () => {
      const params: CreateAiVideoParams = {
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'A cat running in a field',
        duration: 8,
        aspect_ratio: '16:9',
        resolution: '1080p',
      };

      const mockResult = {
        rows: [{
          id: 'task-123',
          platform: 'toapi',
          model: 'veo3.1-fast',
          prompt: 'A cat running in a field',
          status: 'queued',
          progress: 0,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      };

      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await service.createGeneration(params);

      expect(result.id).toBe('task-123');
      expect(result.status).toBe('queued');
      expect(result.progress).toBe(0);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('getGenerationById', () => {
    it('should return generation when found', async () => {
      const mockResult = {
        rows: [{
          id: 'task-123',
          platform: 'toapi',
          status: 'completed',
          progress: 100,
          video_url: 'https://example.com/video.mp4',
        }],
      };

      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await service.getGenerationById('task-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('task-123');
      expect(result?.status).toBe('completed');
    });

    it('should return null when generation not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.getGenerationById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getAllGenerations', () => {
    it('should return paginated results with total count', async () => {
      const mockDataResult = {
        rows: [
          { id: 'task-1', status: 'completed' },
          { id: 'task-2', status: 'in_progress' },
        ],
      };

      const mockCountResult = {
        rows: [{ count: '10' }],
      };

      mockQuery
        .mockResolvedValueOnce(mockDataResult)
        .mockResolvedValueOnce(mockCountResult);

      const result = await service.getAllGenerations({ limit: 20, offset: 0 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(10);
    });

    it('should filter by status', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      await service.getAllGenerations({ status: 'completed' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status ='),
        ['completed']
      );
    });
  });

  describe('getActiveGenerations', () => {
    it('should return generations with queued or in_progress status', async () => {
      const mockResult = {
        rows: [
          { id: 'task-1', status: 'queued' },
          { id: 'task-2', status: 'in_progress' },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await service.getActiveGenerations();

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('queued', 'in_progress')")
      );
    });
  });
  it('provider failure rejects without inserting a fake queued task', async () => {
    createVideo.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.createGeneration({ platform: 'toapi', model: 'veo3.1-fast', prompt: 'fixture' })).rejects.toThrow('provider unavailable');
    expect(query).not.toHaveBeenCalled();
  });
  it('pending task refresh persists actual provider terminal output', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'task-123', platform: 'toapi', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-123', status: 'completed', video_url: 'fixture.mp4' }] });
    getStatus.mockResolvedValueOnce({ status: 'completed', progress: 100, video_url: 'fixture.mp4' });
    expect(await service.getGenerationById('task-123')).toMatchObject({ status: 'completed', video_url: 'fixture.mp4' });
    expect(getStatus).toHaveBeenCalledWith('task-123');
    expect(query.mock.calls[1][1]).toEqual(['completed', 100, 'fixture.mp4', null, null, 'task-123']);
  });
  it('provider status failure preserves the stored task instead of reporting completion', async () => {
    const stored = { id: 'task-123', platform: 'toapi', status: 'queued' };
    query.mockResolvedValueOnce({ rows: [stored] }); getStatus.mockRejectedValueOnce(new Error('network down'));
    expect(await service.getGenerationById('task-123')).toBe(stored);
    expect(query).toHaveBeenCalledOnce();
  });

});
