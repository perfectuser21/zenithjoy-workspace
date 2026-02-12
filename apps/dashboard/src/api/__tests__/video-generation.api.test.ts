import { describe, it, expect } from 'vitest';
import { mapToAPIResponse } from '../video-generation.api';

describe('video-generation.api', () => {
  describe('mapToAPIResponse', () => {
    it('应该正确映射 ToAPI 的 SUCCESS 状态', () => {
      const toApiResponse = {
        task_id: 'task_01KH8CVNNMPJZ546CACNYFWNJC',
        status: 'SUCCESS',
        progress: '100%',
        fail_reason: 'https://upload.apimart.ai/f/video/test.mp4',
        created_at: 1739326797,
        object: 'generation.task'
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.id).toBe('task_01KH8CVNNMPJZ546CACNYFWNJC');
      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.result?.video_url).toBe('https://upload.apimart.ai/f/video/test.mp4');
    });

    it('应该正确映射 ToAPI 的 PROCESSING 状态', () => {
      const toApiResponse = {
        task_id: 'task_xyz',
        status: 'PROCESSING',
        progress: '45%',
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.status).toBe('in_progress');
      expect(result.progress).toBe(45);
    });

    it('应该正确映射 ToAPI 的 FAILED 状态', () => {
      const toApiResponse = {
        task_id: 'task_failed',
        status: 'FAILED',
        progress: '0%',
        error: { message: 'Generation failed' },
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toBe('Generation failed');
    });

    it('应该处理数字类型的进度', () => {
      const toApiResponse = {
        task_id: 'task_123',
        status: 'PROCESSING',
        progress: 75,
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.progress).toBe(75);
    });

    it('应该处理不带百分号的进度字符串', () => {
      const toApiResponse = {
        task_id: 'task_123',
        status: 'PROCESSING',
        progress: '50',
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.progress).toBe(50);
    });

    it('应该处理小写的状态值（向后兼容）', () => {
      const toApiResponse = {
        id: 'task_legacy',
        status: 'success',
        progress: 100,
        result: { video_url: 'https://example.com/video.mp4' },
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.status).toBe('completed');
      expect(result.result?.video_url).toBe('https://example.com/video.mp4');
    });

    it('应该优先使用 task_id 而不是 id', () => {
      const toApiResponse = {
        task_id: 'task_new',
        id: 'task_old',
        status: 'SUCCESS',
        progress: '100%',
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.id).toBe('task_new');
    });

    it('应该忽略非 URL 的 fail_reason', () => {
      const toApiResponse = {
        task_id: 'task_123',
        status: 'FAILED',
        progress: '0%',
        fail_reason: 'Invalid parameters',
        created_at: 1739326797,
      };

      const result = mapToAPIResponse(toApiResponse);

      expect(result.result).toBeUndefined();
    });
  });
});
