import { describe, it, expect, vi } from 'vitest';
import * as controller from '../../src/controllers/ai-video-pipeline-ai.controller';

vi.mock('../../src/services/ai-video-pipeline.service', () => ({
  AiVideoPipelineService: vi.fn().mockImplementation(() => ({
    getJob: vi.fn().mockResolvedValue({ id: 'test-job' }),
  })),
}));

describe('ai-video-pipeline-ai.controller exports', () => {
  it('exports transcribeAudio handler', () => {
    expect(typeof controller.transcribeAudio).toBe('function');
  });
  it('exports designScenes handler', () => {
    expect(typeof controller.designScenes).toBe('function');
  });
  it('exports composeHtml handler', () => {
    expect(typeof controller.composeHtml).toBe('function');
  });
  it('exports generateBgm handler', () => {
    expect(typeof controller.generateBgm).toBe('function');
  });
});

describe('composeHtml — window.__hf', () => {
  it('generated HTML includes window.__hf for HyperFrames seek control', async () => {
    let capturedJson: { html?: string } = {};
    const req = {
      params: { id: 'test-job' },
      body: {
        scenes: [{ start: 0, duration: 5, layout: 'default', eyebrow: 'EB', title: 'T', body: 'B', tags: [] }],
        duration: 5,
      },
    };
    const res = { json: (data: unknown) => { capturedJson = data as { html?: string }; }, status: vi.fn().mockReturnThis() };
    const next = vi.fn();

    await controller.composeHtml(req as never, res as never, next);

    expect(capturedJson.html).toContain('window.__hf');
    expect(capturedJson.html).toContain('seek');
  });
});
