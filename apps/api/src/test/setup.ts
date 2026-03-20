/**
 * Vitest Test Setup
 * 为所有测试提供统一的 mock 和配置
 */

import { vi } from 'vitest';

// Mock database connection for all tests
vi.mock('../db/connection', () => {
  const mockQuery = vi.fn();
  const mockEnd = vi.fn();

  return {
    default: {
      query: mockQuery,
      end: mockEnd,
    },
  };
});

// Mock ToAPI client for unit tests
vi.mock('../clients/toapi.client', () => {
  return {
    ToAPIClient: vi.fn().mockImplementation(() => ({
      createVideoGeneration: vi.fn().mockResolvedValue({
        id: 'mock-task-id',
        model: 'veo3.1-fast',
        status: 'queued',
        progress: 0,
        created_at: Date.now(),
      }),
      getTaskStatus: vi.fn().mockResolvedValue({
        id: 'mock-task-id',
        model: 'veo3.1-fast',
        status: 'completed',
        progress: 100,
        video_url: 'https://example.com/video.mp4',
      }),
    })),
  };
});

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.TOAPI_API_KEY = 'test-api-key';
