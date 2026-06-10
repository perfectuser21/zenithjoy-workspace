/**
 * TDD Red — video-remake 服务 schema 验证
 * 所有 import 引用尚未创建的模块，全部应 FAIL（module not found）
 * Generator 写完实现后，这些测试应变绿
 */
import { describe, it, expect } from 'vitest';

describe('video-remake service — createJob', () => {
  it('createJob 返回 job_id (string) + status="queued"', async () => {
    const { createVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const result = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    expect(typeof result.job_id).toBe('string');
    expect(result.status).toBe('queued');
  });

  it('createJob 响应不含禁用字段 id/jobId/task_id', async () => {
    const { createVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const result = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('jobId');
    expect(result).not.toHaveProperty('task_id');
  });
});

describe('video-remake service — getJob', () => {
  it('getJob 返回 nodes 数组含 9 项，node_id 格式 N01–N09', async () => {
    const { createVideoRemakeJob, getVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const job = await getVideoRemakeJob(created.job_id);
    expect(job.nodes).toHaveLength(9);
    const nodeIds = job.nodes.map((n: { node_id: string }) => n.node_id);
    expect(nodeIds).toContain('N01');
    expect(nodeIds).toContain('N09');
  });

  it('getJob nodes 每项含 node_id/label/status/input/output 字段', async () => {
    const { createVideoRemakeJob, getVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const job = await getVideoRemakeJob(created.job_id);
    const node = job.nodes[0];
    expect(node).toHaveProperty('node_id');
    expect(node).toHaveProperty('label');
    expect(node).toHaveProperty('status');
    expect(node).toHaveProperty('input');
    expect(node).toHaveProperty('output');
  });

  it('getJob 不含禁用字段 node_status/nodeId/nodes_status', async () => {
    const { createVideoRemakeJob, getVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const job = await getVideoRemakeJob(created.job_id);
    expect(job).not.toHaveProperty('node_status');
    expect(job).not.toHaveProperty('nodes_status');
  });

  it('getJob 未知 job_id 抛出 404 错误', async () => {
    const { getVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    await expect(getVideoRemakeJob('non-existent-id')).rejects.toThrow();
  });
});

describe('video-remake service — selectN07Frame', () => {
  it('selectN07Frame 返回 job_id + selected_frame，keys == ["job_id","selected_frame"]', async () => {
    const { createVideoRemakeJob, selectN07Frame } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const result = await selectN07Frame({ jobId: created.job_id, ciAuto: true });
    expect(Object.keys(result).sort()).toEqual(['job_id', 'selected_frame']);
    expect(typeof result.selected_frame).toBe('string');
    expect(result.selected_frame.length).toBeGreaterThan(0);
  });

  it('selectN07Frame 响应不含禁用字段 frame_id/chosen_frame/frameIndex', async () => {
    const { createVideoRemakeJob, selectN07Frame } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const result = await selectN07Frame({ jobId: created.job_id, ciAuto: true });
    expect(result).not.toHaveProperty('frame_id');
    expect(result).not.toHaveProperty('chosen_frame');
    expect(result).not.toHaveProperty('frameIndex');
  });
});

describe('video-remake service — getOutput', () => {
  it('getOutput 返回 job_id + download_url + duration_seconds + has_video_stream', async () => {
    const { createVideoRemakeJob, getVideoRemakeOutput } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const output = await getVideoRemakeOutput(created.job_id);
    expect(Object.keys(output).sort()).toEqual(
      ['download_url', 'duration_seconds', 'has_video_stream', 'job_id'].sort()
    );
    expect(typeof output.download_url).toBe('string');
    expect(typeof output.duration_seconds).toBe('number');
    expect(typeof output.has_video_stream).toBe('boolean');
  });

  it('getOutput 响应不含禁用字段 url/video_url/outputUrl/hasVideo', async () => {
    const { createVideoRemakeJob, getVideoRemakeOutput } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const output = await getVideoRemakeOutput(created.job_id);
    expect(output).not.toHaveProperty('url');
    expect(output).not.toHaveProperty('video_url');
    expect(output).not.toHaveProperty('outputUrl');
    expect(output).not.toHaveProperty('hasVideo');
  });
});
