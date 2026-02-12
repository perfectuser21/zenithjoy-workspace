/**
 * ToAPI Platform Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToAPIPlatform } from '../toapi';

// Mock fetch
global.fetch = vi.fn();

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

  describe('response unwrapping', () => {
    it('should unwrap {code: success, data: ...} format', async () => {
      const mockResponse = {
        code: 'success',
        message: 'OK',
        data: {
          id: 'task_123',
          model: 'veo3.1-fast',
          status: 'processing', // lowercase as per ToAPI format
          progress: 50,
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_123');

      expect(result.id).toBe('task_123');
      expect(result.status).toBe('in_progress');
      expect(result.progress).toBe(50);
    });

    it('should handle direct response format', async () => {
      const mockResponse = {
        id: 'task_456',
        model: 'veo3.1-fast',
        status: 'completed',
        progress: 100,
        video_url: 'https://example.com/video.mp4', // correct field name
        created_at: Date.now(),
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_456');

      expect(result.id).toBe('task_456');
      expect(result.status).toBe('completed');
      expect(result.videoUrl).toBe('https://example.com/video.mp4');
    });
  });

  describe('status mapping', () => {
    it('should map processing to in_progress', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_1',
          model: 'veo3.1-fast',
          status: 'processing', // lowercase
          progress: 30,
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_1');
      expect(result.status).toBe('in_progress');
    });

    it('should map success to completed', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_2',
          model: 'veo3.1-fast',
          status: 'success', // lowercase
          progress: 100,
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_2');
      expect(result.status).toBe('completed');
    });

    it('should map failed to failed', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_3',
          model: 'veo3.1-fast',
          status: 'failed', // lowercase
          progress: 50,
          created_at: Date.now(),
          error: { message: 'Generation failed' },
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_3');
      expect(result.status).toBe('failed');
      expect(result.error?.message).toBe('Generation failed');
    });

    // Uppercase status tests (ToAPI returns uppercase in production)
    it('should map uppercase SUCCESS to completed', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_4',
          model: 'veo3.1-fast',
          status: 'SUCCESS', // UPPERCASE as returned by ToAPI
          progress: 100,
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_4');
      expect(result.status).toBe('completed');
    });

    it('should map uppercase FAILED to failed', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_5',
          model: 'veo3.1-fast',
          status: 'FAILED', // UPPERCASE
          progress: 0,
          created_at: Date.now(),
          error: { message: 'Task failed' },
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_5');
      expect(result.status).toBe('failed');
    });

    it('should map uppercase PROCESSING to in_progress', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_6',
          model: 'veo3.1-fast',
          status: 'PROCESSING', // UPPERCASE
          progress: 75,
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_6');
      expect(result.status).toBe('in_progress');
    });
  });

  describe('video URL mapping', () => {
    it('should use video_url when present', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_7',
          model: 'veo3.1-fast',
          status: 'SUCCESS',
          video_url: 'https://example.com/video1.mp4',
          fail_reason: 'https://example.com/video2.mp4',
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_7');
      expect(result.videoUrl).toBe('https://example.com/video1.mp4');
    });

    it('should fallback to fail_reason when video_url is missing', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_8',
          model: 'veo3.1-fast',
          status: 'SUCCESS',
          fail_reason: 'https://files.toapis.com/flow/abc-123.mp4',
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_8');
      expect(result.videoUrl).toBe('https://files.toapis.com/flow/abc-123.mp4');
    });

    it('should not use fail_reason if it is not a URL', async () => {
      const mockResponse = {
        code: 'success',
        data: {
          id: 'task_9',
          model: 'veo3.1-fast',
          status: 'FAILED',
          fail_reason: 'Generation failed due to invalid prompt',
          created_at: Date.now(),
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.getTaskStatus('task_9');
      expect(result.videoUrl).toBeUndefined();
    });
  });

  describe('createVideoGeneration', () => {
    it('should create video with platform parameter', async () => {
      const mockResponse = {
        id: 'task_new',
        model: 'veo3.1-fast',
        status: 'queued',
        progress: 0,
        created_at: Date.now(),
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await platform.createVideoGeneration({
        platform: 'toapi',
        model: 'veo3.1-fast',
        prompt: 'A cat running in a field',
        duration: 8,
        aspectRatio: '16:9',
        resolution: '1080p',
      });

      expect(result.id).toBe('task_new');
      expect(result.status).toBe('queued');
      expect(result.platform).toBe('toapi');
      expect(result.model).toBe('veo3.1-fast');
    });
  });
});
