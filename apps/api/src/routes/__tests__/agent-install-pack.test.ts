/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

// 注：Sprint 2.1e 旧 GET /download 302 redirect describe 块已删
// （被 Sprint 2.1f Fix 7 server-side license burn-in 取代，见下方 describe 块）
// 补 Task 2 step 2.2 遗漏的 test 减肥

// ↓↓↓ Sprint 2.1f Fix 7 — server-side license burn-in ↓↓↓
vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

describe('Sprint 2.1f Fix 7 — GET /api/agent/install-pack/download server-side license burn-in', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 准备一个真 tar.gz fixture
    const fixDir = path.join(os.tmpdir(), `install-pack-fixture-${Date.now()}`);
    fs.mkdirSync(fixDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixDir, '.env'),
      'ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media\nZENITHJOY_LICENSE=__PLACEHOLDER__\n'
    );
    fs.writeFileSync(path.join(fixDir, 'start.bat'), '@echo off\nREM placeholder\n');
    const fixturePath = path.join(os.tmpdir(), `install-pack-fixture-${Date.now()}.tar.gz`);
    spawnSync('tar', ['-czf', fixturePath, '-C', fixDir, '.'], { stdio: 'pipe' });
    process.env.INSTALL_PACK_FIXTURE_PATH = fixturePath;

    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('登录 user A（持 license ZJ-F-AAAA1111）→ 200 + tar.gz 含 ZENITHJOY_LICENSE=ZJ-F-AAAA1111', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-A-id', email: 'a@test', name: 'A' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-AAAA1111' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/(gzip|octet-stream|x-gzip|x-tar)/);

    const tmpOut = path.join(os.tmpdir(), `download-out-A-${Date.now()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const envContent = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(envContent).toContain('ZENITHJOY_LICENSE=ZJ-F-AAAA1111');
    expect(envContent).not.toContain('__PLACEHOLDER__');
  });

  it('登录 user B（持 license ZJ-F-BBBB2222）→ 解压 .env 含 user B 的 license', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-B-id', email: 'b@test', name: 'B' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-BBBB2222' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);
    const tmpOut = path.join(os.tmpdir(), `download-out-B-${Date.now()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const envContent = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(envContent).toContain('ZENITHJOY_LICENSE=ZJ-F-BBBB2222');
    expect(envContent).not.toContain('AAAA1111');
  });

  it('未登录 → 401 + UNAUTHORIZED', async () => {
    const { auth } = await import('../../auth');
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('登录但用户名下无 license → 503 + NO_ACTIVE_LICENSE', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-no-lic', email: 'n@test', name: 'N' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NO_ACTIVE_LICENSE');
  });
});

// Sprint 2.1h — INSTALL_PACK_REMOTE_URL fallback（本地 tar.gz 不存在时远端拉取缓存）
describe('Sprint 2.1h — INSTALL_PACK_REMOTE_URL fallback', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 清掉 fixture path，让 handler 走 srcTar 路径（不存在）
    delete process.env.INSTALL_PACK_FIXTURE_PATH;
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('本地 tar.gz 不存在 + INSTALL_PACK_REMOTE_URL 未设 → 503 INSTALL_PACK_NOT_BUILT', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    delete process.env.INSTALL_PACK_REMOTE_URL;
    process.env.INSTALL_PACK_STATIC_ROOT = '/tmp/nonexistent-static-root';
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-fallback-test', email: 'f@test', name: 'F' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-DDDD4444' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('INSTALL_PACK_NOT_BUILT');
  });
});

// Sprint 2.1g — sprint 2.1f 减肥后 .env.template 无 ZENITHJOY_LICENSE 占位行场景
describe('Sprint 2.1g Fix — burn fallback append (.env 无占位行也能 work)', () => {
  let app: any;
  beforeEach(async () => {
    vi.clearAllMocks();
    const fixDir = path.join(os.tmpdir(), `install-pack-fixture-noplaceholder-${Date.now()}`);
    fs.mkdirSync(fixDir, { recursive: true });
    // 关键：.env 不含 ZENITHJOY_LICENSE 占位行（模拟 sprint 2.1f Task 2 减肥后的状态）
    fs.writeFileSync(
      path.join(fixDir, '.env'),
      'ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media\nZENITHJOY_CHROME_DEBUG_PORT=19222\n'
    );
    const fixturePath = path.join(os.tmpdir(), `install-pack-fixture-np-${Date.now()}.tar.gz`);
    spawnSync('tar', ['-czf', fixturePath, '-C', fixDir, '.'], { stdio: 'pipe' });
    process.env.INSTALL_PACK_FIXTURE_PATH = fixturePath;
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('.env 无 ZENITHJOY_LICENSE 占位行 → 仍 200 + .env append ZENITHJOY_LICENSE=<key>', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-noenv-id', email: 'noenv@test', name: 'NoEnv' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-CCCC3333' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);

    const tmpOut = path.join(os.tmpdir(), `download-noenv-${Date.now()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const envContent = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(envContent).toContain('ZENITHJOY_LICENSE=ZJ-F-CCCC3333');
    expect(envContent).toContain('ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media');
    expect(envContent).toContain('ZENITHJOY_CHROME_DEBUG_PORT=19222');
  });
});
