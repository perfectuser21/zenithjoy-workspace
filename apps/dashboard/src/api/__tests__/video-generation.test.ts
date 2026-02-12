import { describe, it, expect } from 'vitest';
import { mapToAPIResponse } from '../video-generation.api';

describe('mapToAPIResponse', () => {
  it('应该正确映射标准 status 字段', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'in_progress',
      progress: 50,
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('in_progress');
    expect(result.progress).toBe(50);
    expect(result.id).toBe('task_123');
  });

  it('应该将 state 字段映射为 status', () => {
    const rawResponse = {
      id: 'task_123',
      state: 'processing',
      progress: 30,
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('in_progress');
  });

  it('应该将 pending 映射为 queued', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'pending',
      progress: 0,
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('queued');
  });

  it('应该将 processing 映射为 in_progress', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'processing',
      progress: 25,
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('in_progress');
  });

  it('应该将 success 映射为 completed', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'success',
      progress: 100,
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('completed');
  });

  it('应该将 error 映射为 failed', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'error',
      progress: 50,
      created_at: 1234567890,
      error: { message: 'Something went wrong' },
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('failed');
    expect(result.error).toEqual({ message: 'Something went wrong' });
  });

  it('应该对未知状态使用 queued 作为默认值', () => {
    const rawResponse = {
      id: 'task_123',
      status: undefined,
      progress: 0,
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.status).toBe('queued');
  });

  it('应该对 progress 使用 0 作为默认值', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'in_progress',
      created_at: 1234567890,
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.progress).toBe(0);
  });

  it('应该保留 result 和 completed_at 字段', () => {
    const rawResponse = {
      id: 'task_123',
      status: 'completed',
      progress: 100,
      created_at: 1234567890,
      completed_at: 1234567990,
      result: {
        video_url: 'https://example.com/video.mp4',
        thumbnail_url: 'https://example.com/thumb.jpg',
        duration: 10,
        resolution: '1080p',
      },
    };

    const result = mapToAPIResponse(rawResponse);

    expect(result.completed_at).toBe(1234567990);
    expect(result.result).toEqual({
      video_url: 'https://example.com/video.mp4',
      thumbnail_url: 'https://example.com/thumb.jpg',
      duration: 10,
      resolution: '1080p',
    });
  });
});
