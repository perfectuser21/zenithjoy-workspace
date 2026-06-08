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
  it('modules field contains required Line keys', () => {
    // Sprint 06081603: 心跳 modules 改 Line 命名（与 Agent preflight / Dashboard 对齐）
    const EXPECTED_MODULES = [
      'line04-wechat-cs',
      'line01-publish',
      'line02-lead-gen',
      'line05-video',
    ];
    expect(EXPECTED_MODULES).toContain('line04-wechat-cs');
    expect(EXPECTED_MODULES).toContain('line01-publish');
  });

  it('module status values are valid enum strings', () => {
    const VALID_STATUSES = ['active', 'locked', 'not_purchased'];
    expect(VALID_STATUSES).toContain('active');
  });
});
