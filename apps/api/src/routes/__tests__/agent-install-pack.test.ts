/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as childProcess from 'node:child_process';
const { spawnSync } = childProcess;

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


// Fix: spawnSync → execFileAsync（非阻塞）回归测试
// ESM 限制：vi.spyOn 无法在 ESM namespace 上拦截 spawnSync，改用功能性验证
// 实现侧已替换为 execFileAsync（见 agent-install-pack.ts），此测试确认异步路径正常工作
describe('download handler 不阻塞事件循环 — execFileAsync async path', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fixDir = path.join(os.tmpdir(), `install-pack-async-test-${Date.now()}`);
    fs.mkdirSync(fixDir, { recursive: true });
    fs.writeFileSync(path.join(fixDir, '.env'), 'ZENITHJOY_LICENSE=__PLACEHOLDER__\n');
    const fixturePath = path.join(os.tmpdir(), `install-pack-async-${Date.now()}.tar.gz`);
    spawnSync('tar', ['-czf', fixturePath, '-C', fixDir, '.'], { stdio: 'pipe' });
    process.env.INSTALL_PACK_FIXTURE_PATH = fixturePath;

    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1', sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      size: 60000000, build_time: '2026-05-09T10:00:00Z',
    });

    app = (await import('../../app')).default;
  });
  it('download 使用 execFileAsync 异步完成，返回 200 + .env 含 license', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-async-test', email: 'async@test', name: 'Async' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-ASYNC001' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);

    // 功能验证：tar 解压+重打包均通过 execFileAsync，license 正确写入
    const tmpOut = path.join(os.tmpdir(), `download-async-${Date.now()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const envContent = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(envContent).toContain('ZENITHJOY_LICENSE=ZJ-F-ASYNC001');
    expect(envContent).not.toContain('__PLACEHOLDER__');
  });
});

// COS CDN 路由 — GET /dotenv 返回个人 .env（< 1KB）
describe('COS CDN 路由 — GET /api/agent/install-pack/dotenv', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.1.3',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      cos_url: 'https://example-cos.com/agent/zenithjoy-agent-v1.1.3.tar.gz',
      size: 169197376,
      build_time: '2026-05-20T00:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('登录用户（持 license ZJ-F-DOTENV1）→ 200 + text/plain + ZENITHJOY_LICENSE=ZJ-F-DOTENV1', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-dotenv-id', email: 'd@test', name: 'D' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-DOTENV1' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/dotenv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('ZENITHJOY_LICENSE=ZJ-F-DOTENV1');
    expect(res.text).not.toContain('__PLACEHOLDER__');
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.env/);
  });

  it('未登录 → 401 UNAUTHORIZED', async () => {
    const { auth } = await import('../../auth');
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as any);

    const res = await request(app).get('/api/agent/install-pack/dotenv');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('登录但无 active license → 503 NO_ACTIVE_LICENSE', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-noenv-id', email: 'noenv@test', name: 'NE' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as any);

    const res = await request(app).get('/api/agent/install-pack/dotenv');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NO_ACTIVE_LICENSE');
  });
});

// EROFS fix — 本地文件不存在时 fallback 写 /tmp，不写只读挂载目录
describe('EROFS fix — fallback download 写 /tmp，cos_url 优先', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.INSTALL_PACK_FIXTURE_PATH;
    delete process.env.INSTALL_PACK_REMOTE_URL;
    process.env.INSTALL_PACK_STATIC_ROOT = '/nonexistent-readonly-root';
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.1.3',
      sha256: 'b'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      cos_url: 'https://example-cos.com/agent/zenithjoy-agent-v1.1.3.tar.gz',
      size: 169197376,
      build_time: '2026-05-19T09:20:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('本地文件不存在 + cos_url 设 + 无 INSTALL_PACK_REMOTE_URL → 从 cos_url 拉，503 但不 crash', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-erofs-test', email: 'e@test', name: 'E' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-EEEE5555' }],
    } as any);

    // cos_url 指向一个不存在的地址 → remote fetch 失败 → 503，不 crash
    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('INSTALL_PACK_NOT_BUILT');
    expect(res.body.message).toContain('remote fetch also failed');
  });
});

// PUT /manifest — CI deploy endpoint（HTTP 替换 SSH）
describe('PUT /api/agent/install-pack/manifest', () => {
  let app: any;
  const tmpManifestPath = `/tmp/test-manifest-put-${process.pid}.json`;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.INSTALL_PACK_MANIFEST_PATH = tmpManifestPath;
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'test-internal-token-put';
    app = (await import('../../app')).default;
  });

  afterEach(() => {
    import('fs').then(fs => { try { fs.default.unlinkSync(tmpManifestPath); } catch { /* ok */ } });
    delete process.env.INSTALL_PACK_MANIFEST_PATH;
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  const validManifest = {
    version: '1.2.0',
    sha256: 'a'.repeat(64),
    download_url: '/download/zenithjoy-agent-v1.2.0.tar.gz',
    cos_url: 'https://example.cos.com/install-pack/zenithjoy-agent-v1.2.0.tar.gz',
    size: 169414238,
    build_time: '2026-05-20T04:17:25Z',
  };

  it('有效 token + 有效 manifest → 200 + 文件写入', async () => {
    const res = await request(app)
      .put('/api/agent/install-pack/manifest')
      .set('X-Internal-Token', 'test-internal-token-put')
      .send(validManifest);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('1.2.0');
    const written = JSON.parse(fs.readFileSync(tmpManifestPath, 'utf-8'));
    expect(written.version).toBe('1.2.0');
    expect(written.sha256).toBe('a'.repeat(64));
  });

  it('缺 token → 401 UNAUTHORIZED', async () => {
    const res = await request(app)
      .put('/api/agent/install-pack/manifest')
      .send(validManifest);
    expect(res.status).toBe(401);
  });

  it('错 token → 401 UNAUTHORIZED', async () => {
    const res = await request(app)
      .put('/api/agent/install-pack/manifest')
      .set('X-Internal-Token', 'wrong-token')
      .send(validManifest);
    expect(res.status).toBe(401);
  });

  it('缺必填字段 → 400 INVALID_MANIFEST', async () => {
    const res = await request(app)
      .put('/api/agent/install-pack/manifest')
      .set('X-Internal-Token', 'test-internal-token-put')
      .send({ version: '1.2.0' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_MANIFEST');
  });
});
