import { describe, it, expect } from 'vitest';
import { createPublishLogSchema } from '../schemas';

describe('createPublishLogSchema', () => {
  it('accepts a valid payload with work_id', () => {
    const result = createPublishLogSchema.safeParse({
      work_id: '11111111-1111-1111-1111-111111111111',
      platform: 'douyin',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid payload without work_id (work_id is optional)', () => {
    const result = createPublishLogSchema.safeParse({ platform: 'douyin' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid platform', () => {
    const result = createPublishLogSchema.safeParse({ platform: 'invalid_platform' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed work_id UUID', () => {
    const result = createPublishLogSchema.safeParse({
      work_id: 'not-a-uuid',
      platform: 'douyin',
    });
    expect(result.success).toBe(false);
  });
});
