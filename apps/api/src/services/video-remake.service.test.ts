import { describe, it, expect } from 'vitest';
import {
  createVideoRemakeJob,
  getVideoRemakeJob,
  getRawVideoBuffer,
  approveN06Review,
  selectN07Frame,
  getVideoRemakeOutput,
} from './video-remake.service';

describe('video-remake.service (export sanity)', () => {
  it('exports all required public functions', () => {
    expect(typeof createVideoRemakeJob).toBe('function');
    expect(typeof getVideoRemakeJob).toBe('function');
    expect(typeof getRawVideoBuffer).toBe('function');
    expect(typeof approveN06Review).toBe('function');
    expect(typeof selectN07Frame).toBe('function');
    expect(typeof getVideoRemakeOutput).toBe('function');
  });
});

describe('getRawVideoBuffer', () => {
  it('returns null for unknown job id', () => {
    const result = getRawVideoBuffer('non-existent-job-id-xyz');
    expect(result).toBeNull();
  });
});

describe('createVideoRemakeJob', () => {
  it('returns job_id and status=queued', async () => {
    const buf = Buffer.from('fake-video-data');
    const result = await createVideoRemakeJob({
      filename: 'test.mp4',
      fileSizeBytes: buf.length,
      buffer: buf,
    });
    expect(typeof result.job_id).toBe('string');
    expect(result.job_id.length).toBeGreaterThan(0);
    expect(result.status).toBe('queued');
  });

  it('stores raw buffer accessible via getRawVideoBuffer', async () => {
    const buf = Buffer.from('raw-buffer-data-test');
    const { job_id } = await createVideoRemakeJob({
      filename: 'raw-test.mp4',
      fileSizeBytes: buf.length,
      buffer: buf,
    });
    const stored = getRawVideoBuffer(job_id);
    expect(stored).not.toBeNull();
    expect(stored?.toString()).toBe('raw-buffer-data-test');
  });
});

describe('getVideoRemakeJob', () => {
  it('throws 404 for unknown job id', async () => {
    await expect(getVideoRemakeJob('does-not-exist-abc')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns job with 9 nodes after creation', async () => {
    const buf = Buffer.from('job-nodes-test');
    const { job_id } = await createVideoRemakeJob({
      filename: 'nodes-test.mp4',
      fileSizeBytes: buf.length,
      buffer: buf,
    });
    const job = await getVideoRemakeJob(job_id);
    expect(job.nodes).toHaveLength(9);
    expect(job.nodes[0].node_id).toBe('N01');
    expect(job.nodes[8].node_id).toBe('N09');
  });
});
