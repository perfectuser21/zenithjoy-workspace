import { describe, it, expect, vi } from 'vitest';
const { options } = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock('cos-nodejs-sdk-v5', () => ({ default: class { constructor(value: unknown) { options(value); } } }));
import { CosMaterialStorage } from '../material-storage-cos';
describe('COS connectivity configuration', () => {
  it('uses the configured accelerated endpoint for signed URLs and transfers with bounded network retries', () => {
    new CosMaterialStorage({ COS_SECRET_ID: 'id', COS_SECRET_KEY: 'key', COS_BUCKET: 'bucket', COS_REGION: 'ap-guangzhou', COS_USE_ACCELERATE: 'true' });
    expect(options).toHaveBeenLastCalledWith(expect.objectContaining({ UseAccelerate: true, Timeout: 30000, ChunkRetryTimes: 1 }));
  });
  it('keeps the regional endpoint when acceleration has not been enabled', () => {
    new CosMaterialStorage({ COS_SECRET_ID: 'id', COS_SECRET_KEY: 'key', COS_BUCKET: 'bucket', COS_REGION: 'ap-guangzhou' });
    expect(options).toHaveBeenLastCalledWith(expect.objectContaining({ UseAccelerate: false }));
  });
});
