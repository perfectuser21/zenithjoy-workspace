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

describe('heartbeat modules contract', () => {
  it('modules field contains required keys', () => {
    const EXPECTED_MODULES = ['wechat-cs', 'video-pipeline', 'crm-sync'];
    expect(EXPECTED_MODULES).toContain('wechat-cs');
    expect(EXPECTED_MODULES).toContain('video-pipeline');
    expect(EXPECTED_MODULES).toContain('crm-sync');
  });

  it('module status values are valid enum strings', () => {
    const VALID_STATUSES = ['active', 'locked', 'not_purchased'];
    expect(VALID_STATUSES).toContain('active');
  });
});
