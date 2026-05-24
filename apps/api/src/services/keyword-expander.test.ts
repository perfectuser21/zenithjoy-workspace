import { describe, it, expect, vi, beforeEach } from 'vitest';

// VITEST env is auto-set by vitest runner → expandKeywords uses makeFallback path
describe('expandKeywords', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
  });

  it('returns array of length 5', async () => {
    const { expandKeywords } = await import('./keyword-expander');
    const result = await expandKeywords('装修');
    expect(result).toHaveLength(5);
    expect(Array.isArray(result)).toBe(true);
  });

  it('includes the original keyword as first element', async () => {
    const { expandKeywords } = await import('./keyword-expander');
    const result = await expandKeywords('装修');
    expect(result[0]).toBe('装修');
  });

  it('all elements are non-empty strings', async () => {
    const { expandKeywords } = await import('./keyword-expander');
    const result = await expandKeywords('家具');
    expect(result.every(k => typeof k === 'string' && k.length > 0)).toBe(true);
  });

  it('works for different keyword inputs', async () => {
    const { expandKeywords } = await import('./keyword-expander');
    const result = await expandKeywords('美食');
    expect(result).toHaveLength(5);
    expect(result[0]).toBe('美食');
  });
});
