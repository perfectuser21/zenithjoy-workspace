import { describe, it, expect } from 'vitest';
import * as svc from './walking-skeleton.service';

describe('walking-skeleton service (export sanity)', () => {
  it('module is loadable', () => {
    expect(svc).toBeDefined();
  });
});
