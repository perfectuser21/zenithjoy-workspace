import { describe, it, expect } from 'vitest';
import { getRawVideoBuffer, getVideoRemakeJob, createVideoRemakeJob } from '../video-remake.service';

describe('video-remake.service', () => {
  it('getRawVideoBuffer 未知 jobId 返回 null', () => {
    expect(getRawVideoBuffer('non-existent-job-id')).toBeNull();
  });

  it('getVideoRemakeJob 未知 jobId 抛 404', async () => {
    await expect(getVideoRemakeJob('non-existent-job-id')).rejects.toMatchObject({ status: 404 });
  });

  it('createVideoRemakeJob 创建成功并可查询', async () => {
    const buf = Buffer.from('test');
    const { job_id, status } = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 4, buffer: buf });
    expect(status).toBe('queued');
    expect(getRawVideoBuffer(job_id)).toBe(buf);
    const job = await getVideoRemakeJob(job_id);
    expect(job.job_id).toBe(job_id);
    expect(job.status).toBe('queued');
  });
});
