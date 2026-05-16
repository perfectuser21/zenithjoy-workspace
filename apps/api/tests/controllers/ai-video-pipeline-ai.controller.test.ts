import { describe, it, expect } from 'vitest';
import * as controller from '../../src/controllers/ai-video-pipeline-ai.controller';

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
