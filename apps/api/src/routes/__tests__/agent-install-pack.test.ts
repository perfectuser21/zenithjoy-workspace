/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock manifest service (会在 Task 3 实现)
vi.mock('../../services/install-pack-manifest', () => ({
  readInstallPackManifest: vi.fn(),
}));

import request from 'supertest';
import * as manifestSvc from '../../services/install-pack-manifest';

describe('GET /api/agent/install-pack/manifest', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('manifest 文件存在 → 返 200 + version/sha256/download_url', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '0.2.0',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v0.2.0.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });

    const res = await request(app).get('/api/agent/install-pack/manifest');
    expect(res.status).toBe(200);
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.download_url).toMatch(/^\/download\/zenithjoy-agent-v/);
    expect(typeof res.body.size).toBe('number');
  });

  it('manifest 不存在 → 503 + INSTALL_PACK_NOT_BUILT', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue(null);

    const res = await request(app).get('/api/agent/install-pack/manifest');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('INSTALL_PACK_NOT_BUILT');
  });
});

describe('GET /api/agent/install-pack/download', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('manifest 存在 → 302 重定向到 nginx 静态 URL', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '0.2.0',
      sha256: 'b'.repeat(64),
      download_url: '/download/zenithjoy-agent-v0.2.0.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });

    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/download\/zenithjoy-agent-v/);
  });

  it('manifest 不存在 → 503', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue(null);

    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(503);
  });
});
