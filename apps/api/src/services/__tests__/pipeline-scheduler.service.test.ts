import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Pipeline Scheduler Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // 清除 lastTriggerDate 状态
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('should not trigger when PIPELINE_SCHEDULER_ENABLED is not set', async () => {
    // 默认不启用
    const { startPipelineScheduler, stopPipelineScheduler } = await import('../pipeline-scheduler.service');
    startPipelineScheduler();
    expect(mockFetch).not.toHaveBeenCalled();
    stopPipelineScheduler();
  });
});
