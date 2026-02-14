/**
 * ToAPI Platform Tests
 *
 * Tests the ToAPIPlatform adapter which maps between
 * aiVideoApi responses and UnifiedTask format.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToAPIPlatform } from '../toapi';

// Mock the aiVideoApi module
vi.mock('../../ai-video.api', () => ({
  aiVideoApi: {
    getGenerationById: vi.fn(),
    createGeneration: vi.fn(),
  },
}));

import { aiVideoApi } from '../../ai-video.api';

const mockGetGenerationById = vi.mocked(aiVideoApi.getGenerationById);
const mockCreateGeneration = vi.mocked(aiVideoApi.createGeneration);

describe('ToAPIPlatform', () => {
  let platform: ToAPIPlatform;

  beforeEach(() => {
    platform = new ToAPIPlatform();
    vi.clearAllMocks();
  });

  describe('platform metadata', () => {
    it('should have correct platform ID', () => {
      expect(platform.id).toBe('toapi');
    });

    it('should have correct platform name', () => {
      expect(platform.name).toBe('ToAPI');
    });

    it('should have VEO 3.1 models', () => {
      expect(platform.models).toHaveLength(2);
      expect(platform.models[0].id).toBe('veo3.1-fast');
      expect(platform.models[1].id).toBe('veo3.1-quality');
    });

    it('should have 8 second fixed duration', () => {
      const model = platform.models[0];
      expect(model.capabilities?.fixedDuration).toBe(8);
    });
  });

  describe('getTaskStatus', () => {
    it('should map backend response to UnifiedTask', async () => {
      mockGetGenerationById.mockResolvedValueOnce({
        id: 'task_123',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'test prompt',
        status: 'in_progress',
        progress: 50,
        created_at: '2026-02-14T00:00:00.000Z',
        updated_at: '2026-02-14T00:01:00.000Z',
      });

      const result = await platform.getTaskStatus('task_123');

      expect(mockGetGenerationById).toHaveBeenCalledWith('task_123');
      expect(result.id).toBe('task_123');
      expect(result.platform).toBe('toapi');
      expect(result.model).toBe('veo3.1-fast');
      expect(result.status).toBe('in_progress');
      expect(result.progress).toBe(50);
    });

    it('should map completed status with video_url', async () => {
      mockGetGenerationById.mockResolvedValueOnce({
        id: 'task_456',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'test prompt',
        status: 'completed',
        progress: 100,
        video_url: 'https://example.com/video.mp4',
        created_at: '2026-02-14T00:00:00.000Z',
        completed_at: '2026-02-14T00:05:00.000Z',
        updated_at: '2026-02-14T00:05:00.000Z',
      });

      const result = await platform.getTaskStatus('task_456');

      expect(result.status).toBe('completed');
      expect(result.videoUrl).toBe('https://example.com/video.mp4');
      expect(result.completed_at).toBeDefined();
    });

    it('should map failed status with error_message', async () => {
      mockGetGenerationById.mockResolvedValueOnce({
        id: 'task_789',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'test prompt',
        status: 'failed',
        progress: 0,
        error_message: 'Generation failed due to invalid prompt',
        created_at: '2026-02-14T00:00:00.000Z',
        updated_at: '2026-02-14T00:01:00.000Z',
      });

      const result = await platform.getTaskStatus('task_789');

      expect(result.status).toBe('failed');
      expect(result.error?.message).toBe('Generation failed due to invalid prompt');
      expect(result.videoUrl).toBeUndefined();
    });

    it('should map queued status', async () => {
      mockGetGenerationById.mockResolvedValueOnce({
        id: 'task_q',
        platform: 'toapi',
        model: 'veo3.1-quality',
        prompt: 'test',
        status: 'queued',
        progress: 0,
        created_at: '2026-02-14T00:00:00.000Z',
        updated_at: '2026-02-14T00:00:00.000Z',
      });

      const result = await platform.getTaskStatus('task_q');

      expect(result.status).toBe('queued');
      expect(result.progress).toBe(0);
    });

    it('should convert date strings to timestamps', async () => {
      const createdAt = '2026-02-14T12:00:00.000Z';
      const completedAt = '2026-02-14T12:05:00.000Z';

      mockGetGenerationById.mockResolvedValueOnce({
        id: 'task_date',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'test',
        status: 'completed',
        progress: 100,
        created_at: createdAt,
        completed_at: completedAt,
        updated_at: completedAt,
      });

      const result = await platform.getTaskStatus('task_date');

      expect(result.created_at).toBe(new Date(createdAt).getTime() / 1000);
      expect(result.completed_at).toBe(new Date(completedAt).getTime() / 1000);
    });

    it('should handle missing optional fields', async () => {
      mockGetGenerationById.mockResolvedValueOnce({
        id: 'task_min',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'test',
        status: 'in_progress',
        progress: 25,
        created_at: '2026-02-14T00:00:00.000Z',
        updated_at: '2026-02-14T00:00:00.000Z',
      });

      const result = await platform.getTaskStatus('task_min');

      expect(result.videoUrl).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.completed_at).toBeUndefined();
    });
  });

  describe('createVideoGeneration', () => {
    it('should create video with correct parameters', async () => {
      mockCreateGeneration.mockResolvedValueOnce({
        id: 'task_new',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'A cat running in a field',
        status: 'queued',
        progress: 0,
        created_at: '2026-02-14T00:00:00.000Z',
        updated_at: '2026-02-14T00:00:00.000Z',
      });

      const result = await platform.createVideoGeneration({
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'A cat running in a field',
        duration: 8,
        aspectRatio: '16:9',
        resolution: '1080p',
      });

      expect(mockCreateGeneration).toHaveBeenCalledWith({
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'A cat running in a field',
        duration: 8,
        aspect_ratio: '16:9',
        resolution: '1080p',
        image_urls: undefined,
      });

      expect(result.id).toBe('task_new');
      expect(result.status).toBe('queued');
      expect(result.platform).toBe('toapi');
      expect(result.model).toBe('veo3.1-fast');
    });

    it('should pass image_urls when provided', async () => {
      mockCreateGeneration.mockResolvedValueOnce({
        id: 'task_img',
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'Animate this image',
        status: 'queued',
        progress: 0,
        created_at: '2026-02-14T00:00:00.000Z',
        updated_at: '2026-02-14T00:00:00.000Z',
      });

      await platform.createVideoGeneration({
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'Animate this image',
        duration: 8,
        imageUrls: ['https://example.com/img.jpg'],
      });

      expect(mockCreateGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          image_urls: ['https://example.com/img.jpg'],
        })
      );
    });

    it('should reject invalid model', async () => {
      await expect(
        platform.createVideoGeneration({
          platform: 'toapi',
          model: 'invalid-model',
          prompt: 'test',
          duration: 8,
        })
      ).rejects.toThrow('Invalid params');
    });
  });
});
