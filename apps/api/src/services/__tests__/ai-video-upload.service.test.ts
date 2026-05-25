/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../db/connection';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
  },
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

describe('AiVideoUploadService.createJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts queued record and returns jobId', async () => {
    const mockQuery = vi.mocked(pool.query);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const { AiVideoUploadService } = await import('../ai-video-upload.service');
    const svc = new AiVideoUploadService();
    const result = await svc.createJob({
      jobId: 'job-test-123',
      videoPath: '/tmp/video.mp4',
      scriptText: 'hello world',
    });

    expect(result).toBe('job-test-123');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO zenithjoy.ai_video_generations'),
      expect.arrayContaining(['job-test-123', 'local-whisper-ffmpeg', 'queued', 0])
    );
  });
});
