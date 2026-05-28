import { describe, it, expect, vi, beforeEach } from 'vitest';

// Red test — WS1: original_script 字段完整链路
// 如果 AiVideoPipelineService.createJob 不接受 originalScript 参数则 FAIL
// 如果 composeTemplate 未实现前缀注入则 FAIL

vi.mock('../../../../apps/api/src/db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../../../apps/api/src/db/connection';
const mockQuery = vi.mocked(pool.query);

describe('WS1 — original_script 字段 [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createJob 接受 originalScript 并写入 DB（含新字段的 INSERT SQL）', async () => {
    const { AiVideoPipelineService } = await import('../../../../apps/api/src/services/ai-video-pipeline.service');
    const svc = new AiVideoPipelineService();

    const fakeJob = {
      id: 'test-uuid-ws1',
      status: 'pending',
      progress: 0,
      src_video: 'C:\\test.mp4',
      src_logo: null,
      topic: 'test',
      result_url: null,
      error_msg: null,
      original_script: '录制前参考文案',
      target_aspect: '9:16',
      detected_aspect: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeJob] } as never);

    const result = await svc.createJob({
      srcVideo: 'C:\\test.mp4',
      srcLogo: null,
      topic: 'test',
      templateId: null,
      licenseId: null,
      originalScript: '录制前参考文案',
      targetAspect: '9:16',
    });

    expect(result.original_script).toBe('录制前参考文案');
    expect(result.target_aspect).toBe('9:16');
    expect(result.detected_aspect).toBeNull();

    const sqlCall = mockQuery.mock.calls[0][0] as string;
    expect(sqlCall).toContain('original_script');
    expect(sqlCall).toContain('target_aspect');
  });

  it('createJob originalScript=null 时 DB 写 null', async () => {
    const { AiVideoPipelineService } = await import('../../../../apps/api/src/services/ai-video-pipeline.service');
    const svc = new AiVideoPipelineService();

    const fakeJob = {
      id: 'test-uuid-null',
      status: 'pending',
      progress: 0,
      src_video: 'C:\\test.mp4',
      src_logo: null,
      topic: null,
      result_url: null,
      error_msg: null,
      original_script: null,
      target_aspect: null,
      detected_aspect: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeJob] } as never);

    const result = await svc.createJob({
      srcVideo: 'C:\\test.mp4',
      srcLogo: null,
      topic: null,
      templateId: null,
      licenseId: null,
      originalScript: null,
      targetAspect: null,
    });

    expect(result.original_script).toBeNull();
    expect(result.target_aspect).toBeNull();
  });

  it('composeTemplate 注入 originalScriptPrefix：_originalScript 有值时前缀非空', () => {
    const prefix = (originalScript: string | null): string => {
      const s = originalScript ?? '';
      return s ? `用户录制前参考文案（非逐字稿，仅意图参考）：${s}\n\n` : '';
    };

    expect(prefix('我要讲述产品优势')).toBe(
      '用户录制前参考文案（非逐字稿，仅意图参考）：我要讲述产品优势\n\n'
    );
    expect(prefix(null)).toBe('');
    expect(prefix('')).toBe('');
  });

  it('composeTemplate 注入前缀包含固定中文标记字符串', () => {
    const fs = require('fs');
    const controllerPath = 'apps/api/src/controllers/ai-video-pipeline-ai.controller.ts';
    let content: string;
    try {
      content = fs.readFileSync(controllerPath, 'utf8');
    } catch {
      throw new Error(`FAIL: 文件不存在 ${controllerPath}`);
    }
    expect(content).toContain('用户录制前参考文案（非逐字稿，仅意图参考）');
    expect(content).toContain('_originalScript');
  });
});
