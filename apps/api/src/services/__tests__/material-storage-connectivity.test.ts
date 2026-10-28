import { describe, it, expect } from 'vitest';
import { CosMaterialStorage } from '../material-storage-cos';
const env = { COS_SECRET_ID: 'test-id', COS_SECRET_KEY: 'test-key', COS_BUCKET: 'video-tools-test-1234567890', COS_REGION: 'ap-guangzhou' };
describe('COS signed media endpoint', () => {
  it('signs uploads and reads on the reachable accelerated endpoint when configured', async () => {
    const storage = new CosMaterialStorage({ ...env, COS_USE_ACCELERATE: 'true' });
    for (const address of [await storage.getSignedUrl('video-tools/example.mp4', 60), await storage.presignPut('video-tools/example.mp4', 60)]) {
      const url = new URL(address);
      expect(url.hostname).toBe('video-tools-test-1234567890.cos.accelerate.myqcloud.com');
      expect(url.pathname).toBe('/video-tools/example.mp4');
      expect(url.search).toContain('q-signature');
    }
  });
  it('keeps signed media on the regional endpoint when acceleration is not configured', async () => {
    const storage = new CosMaterialStorage(env);
    const url = new URL(await storage.getSignedUrl('video-tools/example.mp4', 60));
    expect(url.hostname).toBe('video-tools-test-1234567890.cos.ap-guangzhou.myqcloud.com');
    expect(url.search).toContain('q-signature');
  });
});
