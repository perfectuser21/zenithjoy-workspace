/**
 * Jest Test Setup
 * 为所有测试提供统一的 mock 和配置
 */

// Mock database connection for all tests
jest.mock('../db/connection', () => {
  const mockQuery = jest.fn();
  const mockEnd = jest.fn();

  return {
    default: {
      query: mockQuery,
      end: mockEnd,
    },
  };
});

// Mock ToAPI client for unit tests
jest.mock('../clients/toapi.client', () => {
  return {
    ToAPIClient: jest.fn().mockImplementation(() => ({
      createVideoGeneration: jest.fn().mockResolvedValue({
        id: 'mock-task-id',
        model: 'veo3.1-fast',
        status: 'queued',
        progress: 0,
        created_at: Date.now(),
      }),
      getTaskStatus: jest.fn().mockResolvedValue({
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
