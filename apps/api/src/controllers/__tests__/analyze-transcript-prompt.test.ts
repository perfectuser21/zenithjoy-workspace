/**
 * Regression tests for analyzeTranscript prompt quality.
 *
 * Bug: old prompt was too aggressive — removed breath pauses between valid sentences
 * and deleted short segments that were legitimate content transitions.
 *
 * These tests verify the prompt contains the conservative-cut rules before the
 * request is sent to the LLM, so regressions are caught at unit-test time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockQuery = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query: mockQuery } }));

// Capture the prompt sent to OpenRouter without making a real HTTP call
let capturedPrompt = '';
vi.mock('https', () => ({
  default: {
    request: (_opts: unknown, cb: (res: { on: (e: string, fn: unknown) => void; statusCode: number }) => void) => {
      const res = {
        statusCode: 200,
        on: (event: string, fn: (chunk?: string) => void) => {
          if (event === 'data') fn(JSON.stringify({ choices: [{ message: { content: '{"segments":[{"index":0,"keep":true,"reason":"test"}]}' } }] }));
          if (event === 'end') fn();
        },
      };
      cb(res);
      return { on: vi.fn(), write: (body: string) => { capturedPrompt = JSON.parse(body)?.messages?.[0]?.content ?? ''; }, end: vi.fn(), setTimeout: vi.fn() };
    },
  },
}));

describe('analyzeTranscript — prompt content regression', () => {
  beforeEach(() => {
    capturedPrompt = '';
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'job-1', template_id: null }] });
    vi.resetModules();
  });

  async function callAnalyze(segments: Array<{ start: number; end: number; text: string }>) {
    const { analyzeTranscript } = await import('../ai-video-pipeline-ai.controller');
    const req = {
      params: { id: 'job-1' },
      body: { segments, duration: 60, topic: '电商运营技巧' },
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    await analyzeTranscript(req, res, (() => {}) as NextFunction);
    return capturedPrompt;
  }

  it('prompt instructs conservative cut (15-25%)', async () => {
    const prompt = await callAnalyze([{ start: 0, end: 2, text: '嗯' }]);
    expect(prompt).toContain('15-25%');
  });

  it('prompt explicitly says to keep breath pauses between valid sentences', async () => {
    const prompt = await callAnalyze([{ start: 0, end: 2, text: '然后' }]);
    expect(prompt).toMatch(/气口|两侧有有效内容就保留/);
  });

  it('prompt forbids deleting short sentences', async () => {
    const prompt = await callAnalyze([{ start: 0, end: 1, text: '好' }]);
    expect(prompt).toMatch(/不能因句子短就删|不能.*短.*删/);
  });

  it('prompt forbids deleting filler words like 然后/就是', async () => {
    const prompt = await callAnalyze([{ start: 0, end: 1, text: '就是这样' }]);
    expect(prompt).toMatch(/然后、就是、那个/);
  });

  it('prompt only removes completely off-topic content, not loosely related', async () => {
    const prompt = await callAnalyze([{ start: 0, end: 2, text: '这个数据很好' }]);
    expect(prompt).toMatch(/完全跑题|接电话|和路人说话/);
  });
});
