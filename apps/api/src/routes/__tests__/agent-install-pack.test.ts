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

// agent→staging 隔离 — 下载时烧本实例对外地址进 .env（让 staging 下的 agent 连 staging）
describe('agent→staging — download 烧 AGENT_PUBLIC_* 进 .env 的 ZENITHJOY_API_URL/BASE', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fixDir = path.join(os.tmpdir(), `install-pack-urlburn-${Date.now()}`);
    fs.mkdirSync(fixDir, { recursive: true });
    // fixture .env 带生产 base（模拟静态包默认），断言被 staging 值覆盖
    fs.writeFileSync(
      path.join(fixDir, '.env'),
      'ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media\nZENITHJOY_LICENSE=__PLACEHOLDER__\n'
    );
    const fixturePath = path.join(os.tmpdir(), `install-pack-urlburn-${Date.now()}.tar.gz`);
    spawnSync('tar', ['-czf', fixturePath, '-C', fixDir, '.'], { stdio: 'pipe' });
    process.env.INSTALL_PACK_FIXTURE_PATH = fixturePath;
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1', sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      size: 60000000, build_time: '2026-05-09T10:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  afterEach(() => {
    delete process.env.AGENT_PUBLIC_WS_URL;
    delete process.env.AGENT_PUBLIC_BASE_URL;
  });

  async function downloadEnv(): Promise<string> {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-urlburn', email: 'u@test', name: 'U' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-UUUU1111' }],
    } as any);
    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);
    const tmpOut = path.join(os.tmpdir(), `dl-urlburn-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    return fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
  }

  it('AGENT_PUBLIC_* 设为 staging → .env 烧 staging 的 ZENITHJOY_API_URL/BASE（覆盖生产 base）', async () => {
    process.env.AGENT_PUBLIC_WS_URL = 'wss://staging-autopilot.zenjoymedia.media/agent-ws';
    process.env.AGENT_PUBLIC_BASE_URL = 'https://staging-autopilot.zenjoymedia.media';
    const env = await downloadEnv();
    expect(env).toContain('ZENITHJOY_API_URL=wss://staging-autopilot.zenjoymedia.media/agent-ws');
    expect(env).toContain('ZENITHJOY_API_BASE=https://staging-autopilot.zenjoymedia.media');
    // 关键：原 fixture 的生产 base 被覆盖，不残留
    expect(env).not.toContain('ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media');
    expect(env).toContain('ZENITHJOY_LICENSE=ZJ-F-UUUU1111');
  });

  it('AGENT_PUBLIC_* 未设（如本地 dev）→ 不烧 URL（no-op，保持原 .env 不动）', async () => {
    delete process.env.AGENT_PUBLIC_WS_URL;
    delete process.env.AGENT_PUBLIC_BASE_URL;
    const env = await downloadEnv();
    // 不注入 ZENITHJOY_API_URL；原生产 base 原样保留（行为同旧）
    expect(env).not.toContain('ZENITHJOY_API_URL=');
    expect(env).toContain('ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media');
    expect(env).toContain('ZENITHJOY_LICENSE=ZJ-F-UUUU1111');
  });
});

// agent→staging — /dotenv 也带本实例对外地址
describe('agent→staging — /dotenv 含 AGENT_PUBLIC_* 烧的 ZENITHJOY_API_URL/BASE', () => {
  let app: any;
  beforeEach(async () => {
    vi.clearAllMocks();
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.1.3', sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      size: 169197376, build_time: '2026-05-20T00:00:00Z',
    });
    app = (await import('../../app')).default;
  });
  afterEach(() => {
    delete process.env.AGENT_PUBLIC_WS_URL;
    delete process.env.AGENT_PUBLIC_BASE_URL;
  });

  it('staging slot 的 /dotenv → 含 staging 的 ZENITHJOY_API_URL/BASE', async () => {
    process.env.AGENT_PUBLIC_WS_URL = 'wss://staging-autopilot.zenjoymedia.media/agent-ws';
    process.env.AGENT_PUBLIC_BASE_URL = 'https://staging-autopilot.zenjoymedia.media';
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-dotenv-staging', email: 'ds@test', name: 'DS' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-DDDD2222' }],
    } as any);
    const res = await request(app).get('/api/agent/install-pack/dotenv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ZENITHJOY_LICENSE=ZJ-F-DDDD2222');
    expect(res.text).toContain('ZENITHJOY_API_URL=wss://staging-autopilot.zenjoymedia.media/agent-ws');
    expect(res.text).toContain('ZENITHJOY_API_BASE=https://staging-autopilot.zenjoymedia.media');
  });
});

// 遗留② 根治 — "staging 下却连生产" 真因：个人 .env 只烧了 URL，缺 staging 环境标记，
// 用户没应用个人 .env 时就回落到 COS 包 .env.template 里写死的生产 ZENITHJOY_ENV/URL。
// 修法：agentApiUrlEnvLines 从本实例对外地址推导 ZENITHJOY_ENV 一并烧进个人 .env，
// 让个人 .env 自描述环境（staging slot → staging / 生产 slot → prod），盖掉模板默认值。
describe('agent→staging 隔离 — /dotenv + download 烧 ZENITHJOY_ENV 环境标记', () => {
  let app: any;
  afterEach(() => {
    delete process.env.AGENT_PUBLIC_WS_URL;
    delete process.env.AGENT_PUBLIC_BASE_URL;
    delete process.env.INSTALL_PACK_FIXTURE_PATH;
  });

  async function loadApp() {
    vi.clearAllMocks();
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.1.3', sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      size: 169197376, build_time: '2026-05-20T00:00:00Z',
    });
    app = (await import('../../app')).default;
  }

  async function getDotenv(userId: string): Promise<string> {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: userId, email: `${userId}@test`, name: userId },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-FBFYTLFR' }],
    } as any);
    const res = await request(app).get('/api/agent/install-pack/dotenv');
    expect(res.status).toBe(200);
    return res.text;
  }

  it('staging slot（AGENT_PUBLIC_BASE_URL=staging）→ /dotenv 含 ZENITHJOY_ENV=staging', async () => {
    await loadApp();
    process.env.AGENT_PUBLIC_WS_URL = 'wss://staging-autopilot.zenjoymedia.media/agent-ws';
    process.env.AGENT_PUBLIC_BASE_URL = 'https://staging-autopilot.zenjoymedia.media';
    const env = await getDotenv('user-envmark-staging');
    expect(env).toContain('ZENITHJOY_ENV=staging');
    expect(env).not.toContain('ZENITHJOY_ENV=prod');
  });

  it('生产 slot（AGENT_PUBLIC_BASE_URL=autopilot）→ /dotenv 含 ZENITHJOY_ENV=prod', async () => {
    await loadApp();
    process.env.AGENT_PUBLIC_WS_URL = 'wss://autopilot.zenjoymedia.media/agent-ws';
    process.env.AGENT_PUBLIC_BASE_URL = 'https://autopilot.zenjoymedia.media';
    const env = await getDotenv('user-envmark-prod');
    expect(env).toContain('ZENITHJOY_ENV=prod');
    expect(env).not.toContain('ZENITHJOY_ENV=staging');
  });

  it('AGENT_PUBLIC_* 未配（本地 dev）→ /dotenv 不烧 ZENITHJOY_ENV（no-op，行为同旧）', async () => {
    await loadApp();
    delete process.env.AGENT_PUBLIC_WS_URL;
    delete process.env.AGENT_PUBLIC_BASE_URL;
    const env = await getDotenv('user-envmark-dev');
    expect(env).not.toContain('ZENITHJOY_ENV=');
  });

  it('staging slot 的 download → .env 烧 ZENITHJOY_ENV=staging（盖掉模板里的 prod）', async () => {
    await loadApp();
    process.env.AGENT_PUBLIC_WS_URL = 'wss://staging-autopilot.zenjoymedia.media/agent-ws';
    process.env.AGENT_PUBLIC_BASE_URL = 'https://staging-autopilot.zenjoymedia.media';
    // fixture .env 模拟 COS 包模板：写死生产 ENV + 生产 URL，断言被 staging 覆盖
    const fixDir = path.join(os.tmpdir(), `install-pack-envmark-${Date.now()}`);
    fs.mkdirSync(fixDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixDir, '.env'),
      'ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media\nZENITHJOY_ENV=prod\nZENITHJOY_LICENSE=__PLACEHOLDER__\n'
    );
    const fixturePath = path.join(os.tmpdir(), `install-pack-envmark-${Date.now()}.tar.gz`);
    spawnSync('tar', ['-czf', fixturePath, '-C', fixDir, '.'], { stdio: 'pipe' });
    process.env.INSTALL_PACK_FIXTURE_PATH = fixturePath;

    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-envmark-dl', email: 'dl@test', name: 'DL' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-FBFYTLFR' }],
    } as any);
    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);
    const tmpOut = path.join(os.tmpdir(), `dl-envmark-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const env = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(env).toContain('ZENITHJOY_ENV=staging');
    expect(env).not.toContain('ZENITHJOY_ENV=prod');
    expect(env).toContain('ZENITHJOY_API_BASE=https://staging-autopilot.zenjoymedia.media');
  });
});

// Gap3 — 大包别经服务器中转流式（经 CF tunnel 322MB 只回 19.5MB 就断、tar 解不开）：
// manifest 有 cos_url → /download 直接 302 重定向到 COS 直链，客户端直连 COS 拉整包（rog 实测 7.6s OK）。
// license 走独立 /dotenv 端点（不再夹在 tar 里），避免大包重打包/流式截断。
describe('Gap3 — GET /download 有 cos_url 时 302 重定向到 COS 直链（不再服务器中转流式）', () => {
  let app: any;
  const COS_URL = 'https://zenithjoy-1234.cos.ap-shanghai.myqcloud.com/install-pack/zenithjoy-agent-v1.0.1.tar.gz';

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.INSTALL_PACK_FIXTURE_PATH; // 不走本地 fixture
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      cos_url: COS_URL,
      size: 337000000, // 322MB 级大包
      build_time: '2026-06-25T00:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('登录 user + manifest 有 cos_url → 302 Location=cos_url（不重打包/不流式）', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-cos-302', email: 'c@test', name: 'C' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-COSCOS11' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(COS_URL);
  });

  it('未登录 → 仍 401（302 不绕过鉴权）', async () => {
    const { auth } = await import('../../auth');
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as any);
    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('登录但无 license → 仍 503 NO_ACTIVE_LICENSE（鉴权后才考虑 302）', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-cos-nolic', email: 'cn@test', name: 'CN' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as any);
    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
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

// Gap3 替代旧 EROFS fix 用例：cos_url 设 → 不再服务器中转拉取，直接 302 到 COS（不 crash、不 503）。
// 旧行为（cos_url 设 → 服务器从 cos 拉回再重打包流式）已被 Gap3 替换，原"远端拉失败 503"断言不再适用。
describe('Gap3 替代旧 EROFS — cos_url 设 → 302 直连 COS（不再服务器中转）', () => {
  let app: any;
  const COS = 'https://example-cos.com/agent/zenithjoy-agent-v1.1.3.tar.gz';

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.INSTALL_PACK_FIXTURE_PATH;
    delete process.env.INSTALL_PACK_REMOTE_URL;
    process.env.INSTALL_PACK_STATIC_ROOT = '/nonexistent-readonly-root';
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.1.3',
      sha256: 'b'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.1.3.tar.gz',
      cos_url: COS,
      size: 169197376,
      build_time: '2026-05-19T09:20:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('本地文件不存在 + cos_url 设 → 302 Location=cos_url（不服务器拉取、不 503、不 crash）', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-erofs-test', email: 'e@test', name: 'E' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-EEEE5555' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(COS);
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

// Path2 Step2 — 安卓 APK 分发 + 深链绑定信息（客户自助装机绑定第一刀）
// 复用 /download 同款 session 鉴权 + active license 查询；不改桌面 manifest。
describe('GET /api/agent/install-pack/android', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('无 session → 401 UNAUTHORIZED', async () => {
    const { auth } = await import('../../auth');
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as any);

    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('有 session + active license → 200，apk_url 是 COS 直链，deeplink 带 license', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-android-1' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-A1B2C3D4' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(200);
    expect(res.body.apk_url).toMatch(/^https:\/\/.*\.myqcloud\.com\/install-pack\/android\/zenithjoy-agent\.apk$/);
    expect(res.body.deeplink).toMatch(/^zenithjoy:\/\/bind\?/);
    expect(res.body.deeplink).toContain('license=ZJ-F-A1B2C3D4');
    expect(res.body.license_key).toBe('ZJ-F-A1B2C3D4');
  });

  it('有 session 无 license → 200，deeplink 不含 license 参数', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-android-2' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as any);

    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(200);
    expect(res.body.license_key).toBe('');
    expect(res.body.deeplink).not.toContain('license=');
    expect(res.body.deeplink).toContain('api=');
  });
});
