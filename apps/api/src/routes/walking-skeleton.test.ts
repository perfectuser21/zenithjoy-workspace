import { describe, it, expect } from 'vitest';
import { heartbeatRouter, publishWsRouter } from './walking-skeleton';

describe('walking-skeleton routes (export sanity)', () => {
  it('heartbeatRouter is an Express Router (function with stack)', () => {
    expect(typeof heartbeatRouter).toBe('function');
    expect(Array.isArray(heartbeatRouter.stack)).toBe(true);
  });

  it('publishWsRouter is an Express Router (function with stack)', () => {
    expect(typeof publishWsRouter).toBe('function');
    expect(Array.isArray(publishWsRouter.stack)).toBe(true);
  });
});
