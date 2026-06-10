import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/video-remake.service', () => ({
  createVideoRemakeJob: vi.fn(),
  getVideoRemakeJob: vi.fn(),
  approveN06Review: vi.fn(),
  selectN07Frame: vi.fn(),
  getVideoRemakeOutput: vi.fn(),
  getRawVideoBuffer: vi.fn(),
}));

import {
  createJob,
  getJob,
  continueN06,
  selectN07,
  getOutput,
  serveRawVideo,
} from './video-remake.controller';
import { getRawVideoBuffer } from '../services/video-remake.service';

describe('video-remake.controller (export sanity)', () => {
  it('exports all required handler functions', () => {
    expect(typeof createJob).toBe('function');
    expect(typeof getJob).toBe('function');
    expect(typeof continueN06).toBe('function');
    expect(typeof selectN07).toBe('function');
    expect(typeof getOutput).toBe('function');
    expect(typeof serveRawVideo).toBe('function');
  });
});

describe('serveRawVideo', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let endMock: ReturnType<typeof vi.fn>;
  let setHeaderMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    endMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock, end: endMock });
    setHeaderMock = vi.fn();
    req = { params: { job_id: 'test-job-123' } };
    res = {
      status: statusMock,
      setHeader: setHeaderMock,
      end: endMock,
    };
    vi.clearAllMocks();
  });

  it('returns 404 when buffer not found', () => {
    (getRawVideoBuffer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    serveRawVideo(req as Request, res as Response);
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Raw video not found' });
  });

  it('returns 200 with video/mp4 content-type when buffer found', () => {
    const buf = Buffer.from('fake-mp4-data');
    (getRawVideoBuffer as ReturnType<typeof vi.fn>).mockReturnValue(buf);
    (res as Response & { status: ReturnType<typeof vi.fn> }).status = vi.fn().mockReturnValue(res);
    res.status = vi.fn().mockReturnValue({ end: endMock });
    serveRawVideo(req as Request, res as Response);
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Length', buf.length);
  });
});
