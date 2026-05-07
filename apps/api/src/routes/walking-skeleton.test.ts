import { describe, it, expect } from 'vitest';
import { heartbeatRouter, publishWsRouter } from './walking-skeleton';

describe('walking-skeleton routes (export sanity)', () => {
  it('exports heartbeatRouter', () => {
    expect(heartbeatRouter).toBeDefined();
  });

  it('exports publishWsRouter', () => {
    expect(publishWsRouter).toBeDefined();
  });
});
