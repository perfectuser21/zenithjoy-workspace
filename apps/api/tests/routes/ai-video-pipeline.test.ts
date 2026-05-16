import { describe, it, expect } from 'vitest';
import router from '../../src/routes/ai-video-pipeline';

describe('ai-video-pipeline route module', () => {
  it('exports an Express Router', () => {
    expect(typeof router).toBe('function');
  });

  it('router has routes registered', () => {
    const stack = (router as unknown as { stack: unknown[] }).stack;
    expect(Array.isArray(stack)).toBe(true);
    expect(stack.length).toBeGreaterThan(0);
  });
});
