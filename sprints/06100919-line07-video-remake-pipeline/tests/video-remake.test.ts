/**
 * TDD Red — video-remake 服务 schema + 行为验证
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

  it('fileSizeBytes > 100MB 时抛出错误', async () => {
    const { createVideoRemakeJob } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    await expect(
      createVideoRemakeJob({ filename: 'large.mp4', fileSizeBytes: 104857601, buffer: Buffer.from('') })
    ).rejects.toThrow();
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

describe('video-remake service — analyzeSceneFrame (N03)', () => {
  it('N03 output 含 original_frame_url (非空 string)', async () => {
    const { analyzeSceneFrame } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const result = await analyzeSceneFrame({ frameUrl: 'fixture://test-frame-0.jpg', frameIndex: 0 });
    expect(typeof result.original_frame_url).toBe('string');
    expect(result.original_frame_url.length).toBeGreaterThan(0);
  });

  it('N03 output 含 prompt_text (非空 string)', async () => {
    const { analyzeSceneFrame } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const result = await analyzeSceneFrame({ frameUrl: 'fixture://test-frame-0.jpg', frameIndex: 0 });
    expect(typeof result.prompt_text).toBe('string');
    expect(result.prompt_text.length).toBeGreaterThan(0);
  });
});

describe('video-remake service — evaluateFrameScores (N05)', () => {
  it('N05 output.frames 为非空数组，每项含 redrawn_frame_url + score', async () => {
    const { evaluateFrameScores } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const result = await evaluateFrameScores({
      redrawnFrames: [
        { original_frame_url: 'fixture://orig-0.jpg', redrawn_frame_url: 'fixture://redrawn-0.jpg' }
      ]
    });
    expect(Array.isArray(result.frames)).toBe(true);
    expect(result.frames.length).toBeGreaterThan(0);
    const f = result.frames[0];
    expect(typeof f.redrawn_frame_url).toBe('string');
    expect(typeof f.score).toBe('number');
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
  it('getOutput 返回 job_id + download_url + duration_seconds(>0) + has_video_stream(true)', async () => {
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
    expect(output.duration_seconds).toBeGreaterThan(0);
    expect(output.has_video_stream).toBe(true);
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

describe('video-remake service — extractFrames (N02)', () => {
  it('N02 extractFrames 返回 frames 非空数组，每项含 frame_url(string) + timestamp_seconds(number)', async () => {
    process.env.TEST_MODE = '1';
    const { createVideoRemakeJob, extractFrames } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const result = await extractFrames({ jobId: created.job_id });
    expect(Array.isArray(result.frames)).toBe(true);
    expect(result.frames.length).toBeGreaterThan(0);
    const f = result.frames[0];
    expect(typeof f.frame_url).toBe('string');
    expect(f.frame_url.length).toBeGreaterThan(0);
    expect(typeof f.timestamp_seconds).toBe('number');
    delete process.env.TEST_MODE;
  });
});

describe('video-remake service — redrawFrameWithToAPI success (N04)', () => {
  it('TEST_MODE=1 时 redrawFrameWithToAPI 返回 { original_frame_url: string, redrawn_frame_url: string }', async () => {
    process.env.TEST_MODE = '1';
    const { redrawFrameWithToAPI } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const result = await redrawFrameWithToAPI({ frameUrl: 'fixture://test-frame-0.jpg', frameIndex: 0 });
    expect(typeof result.original_frame_url).toBe('string');
    expect(result.original_frame_url.length).toBeGreaterThan(0);
    expect(typeof result.redrawn_frame_url).toBe('string');
    expect(result.redrawn_frame_url.length).toBeGreaterThan(0);
    delete process.env.TEST_MODE;
  });
});

describe('video-remake service — approveN06Review (N06)', () => {
  it('approveN06Review 返回 { job_id: string, node_id: "N06", status: "done" }', async () => {
    process.env.TEST_MODE = '1';
    const { createVideoRemakeJob, approveN06Review } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    const created = await createVideoRemakeJob({ filename: 'test.mp4', fileSizeBytes: 1024, buffer: Buffer.from('') });
    const result = await approveN06Review({ jobId: created.job_id });
    expect(result.node_id).toBe('N06');
    expect(result.status).toBe('done');
    expect(typeof result.job_id).toBe('string');
    delete process.env.TEST_MODE;
  });
});

describe('video-remake service — N04 error path', () => {
  it('FORCE_TOAPI_FAIL=1 时 redrawFrameWithToAPI 抛出 { code: "N04_API_FAILURE" }', async () => {
    process.env.FORCE_TOAPI_FAIL = '1';
    const { redrawFrameWithToAPI } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    await expect(
      redrawFrameWithToAPI({ frameUrl: 'test.jpg', frameIndex: 0 })
    ).rejects.toMatchObject({ code: 'N04_API_FAILURE' });
    delete process.env.FORCE_TOAPI_FAIL;
  });
});

describe('video-remake service — N08 timeout path', () => {
  it('N08_TIMEOUT_MS=1 时 generateVideoWithDashScope 抛出 { code: "N08_TIMEOUT" }', async () => {
    process.env.N08_TIMEOUT_MS = '1';
    const { generateVideoWithDashScope } = await import(
      '../../../apps/api/src/services/video-remake.service.js'
    );
    await expect(
      generateVideoWithDashScope({ frameUrl: 'test.jpg', apiKey: 'test-key' })
    ).rejects.toMatchObject({ code: 'N08_TIMEOUT' });
    delete process.env.N08_TIMEOUT_MS;
  });
});
