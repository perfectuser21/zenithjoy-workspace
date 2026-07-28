/**
 * TDD Red — Staff Hub 业务线健康看板（GP3 / line_health）
 * Sprint: 07281207-staff-line-health-dashboard
 *
 * 覆盖 GET /api/staff/line-health 系列 3 个端点：
 *   - GET /api/staff/line-health
 *   - GET /api/staff/line-health/:lineKey/deployment
 *   - GET /api/staff/line-health/:lineKey/abilities
 *
 * Mock 策略（Rule C 已在 contract-draft.md「未覆盖真实链路清单」登记）：
 *   - Brain journey_features（axios.get 命中 '/journey_features'）→ 打桩，返回值锚定合同里
 *     字面写死的 line04 journeyId 'e675da0f-1117-4301-a801-cd4753beb8c8'（PR #1487 已修复值）
 *   - GitHub REST API（api.github.com，包括 commits/search/branches）→ **默认不打桩，走真实网络**，
 *     符合 Rule B「第三方真调一次」在测试层面也尽量真实、同时规避对未实现代码的 GH 调用形状过度猜测。
 *     断言只做类型/格式检查（如 commit_sha 是否匹配 40 位 hex），不断言具体值，因为真实数据会变化。
 *     Reviewer r1 修复项1/2 新增两个局部工具，只在各自那一条测试里生效、用完立即复位为 null/清空：
 *       - `githubMockOverride.handler` — 仅供"陈旧分支判定"一条测试局部覆盖 GitHub 响应（虚拟旧
 *         commit_date），验证 30 天阈值判定逻辑本身；其余测试该值恒为 null，GitHub 请求仍走真实网络。
 *       - `githubRealGetSpy` — 包裹真实网络调用做计数，供"GitHub 数据缓存 TTL"断言使用（两次连续
 *         请求真实调用次数不增加 = 缓存命中），不整体 mock 掉 GitHub，也不等待真实 5 分钟。
 *   - product-map.json → 真实文件系统读取；仅缺失/损坏场景用 vi.spyOn(fs,'readFileSync') 局部打桩
 *     （要求实现按请求读取该文件，而非仅在进程启动时读一次并永久缓存，否则该场景不可测）
 *
 * evaluator 不直接跑本文件；真实验收命令在 contract-dod.md [BEHAVIOR] manual:bash 里。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import request from 'supertest';

vi.mock('../../../apps/api/src/db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../apps/api/src/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('../../../apps/api/src/middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  tenantKeyFn: () => 'anonymous',
}));

const brainGetMock = vi.hoisted(() => vi.fn());
// Reviewer r1 修复项1：仅供"陈旧分支判定"一条测试局部覆盖 GitHub 响应，其余测试恒为 null。
const githubMockOverride = vi.hoisted(() => ({
  handler: null as null | ((url: string, config?: Record<string, unknown>) => Promise<unknown>),
}));
// Reviewer r1 修复项2：包裹真实 GitHub 网络调用做计数，供缓存 TTL 断言使用。
const githubRealGetSpy = vi.hoisted(() => vi.fn());

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const realGet = actual.default.get.bind(actual.default);
  const routedGet = (url: string, config?: Record<string, unknown>) => {
    if (typeof url === 'string' && url.includes('/journey_features')) {
      return brainGetMock(url, config);
    }
    if (typeof url === 'string' && url.includes('api.github.com')) {
      if (githubMockOverride.handler) {
        return githubMockOverride.handler(url, config);
      }
      githubRealGetSpy(url, config);
      return realGet(url, config);
    }
    // 其余非 Brain/GitHub 请求一律走真实网络，不打桩
    return realGet(url, config);
  };
  return {
    default: {
      ...actual.default,
      get: routedGet,
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

// app 必须在上面所有 vi.mock 之后动态 import，确保 mock 生效
const { default: app } = await import('../../../apps/api/src/app');

const LINE04_JOURNEY_ID = 'e675da0f-1117-4301-a801-cd4753beb8c8';
const STAFF_HEADER = { 'X-User-Email': 'staff@test.com' };

function mockBrainAbilities(features: Array<Record<string, unknown>>) {
  brainGetMock.mockImplementation((_url: string, config?: { params?: { journey_id?: string } }) => {
    const journeyId = config?.params?.journey_id;
    if (journeyId === LINE04_JOURNEY_ID) {
      return Promise.resolve({ data: features });
    }
    // 任何其它 journey_id 都不该被查到（line01/line02 压根不该发起这个请求）
    return Promise.resolve({ data: [] });
  });
}

function mockGithubStaleCommit(daysAgo: number) {
  const oldDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const fixedSha = 'a'.repeat(40);
  githubMockOverride.handler = (url: string) => {
    if (url.includes('/commits')) {
      return Promise.resolve({
        data: [
          {
            sha: fixedSha,
            commit: { message: 'old commit', author: { date: oldDate } },
            html_url: `https://github.com/perfectuser21/zenithjoy-workspace/commit/${fixedSha}`,
          },
        ],
      });
    }
    if (url.includes('/search/issues')) {
      return Promise.resolve({ data: { items: [] } });
    }
    // 分支存在性探活或其它 GitHub 调用：返回空数组（分支存在但无匹配），不影响本条断言目标
    return Promise.resolve({ data: [] });
  };
}

beforeEach(() => {
  vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  brainGetMock.mockReset();
  githubRealGetSpy.mockReset();
  githubMockOverride.handler = null;
  mockBrainAbilities([
    { id: 'gpb', name: 'GP-B 被动接待', status: 'planned', thickness: 'thin', kind: 'ability', updated_at: '2026-07-28T00:00:00Z' },
    { id: 'gpc', name: 'GP-C 主动触达', status: 'done', thickness: 'thin', kind: 'ability', updated_at: '2026-07-28T00:00:00Z' },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  githubMockOverride.handler = null;
});

describe('GET /api/staff/line-health — 总览三卡片 [BEHAVIOR]', () => {
  it('返回 line01/line02/line04 三条，line01 标 not_connected 而非 0/0', async () => {
    const res = await request(app).get('/api/staff/line-health').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    const lineKeys = res.body.data.map((d: { line_key: string }) => d.line_key).sort();
    expect(lineKeys).toEqual(['line01', 'line02', 'line04']);
    const line01 = res.body.data.find((d: { line_key: string }) => d.line_key === 'line01');
    expect(line01.availability).toBe('not_connected');
  });

  it('line01/line02 maturity 字面为 not_connected 且 journey_id 为 null（判定点1，非靠0/0反推）', async () => {
    const res = await request(app).get('/api/staff/line-health').set(STAFF_HEADER);
    const line02 = res.body.data.find((d: { line_key: string }) => d.line_key === 'line02');
    expect(line02.maturity).toBe('not_connected');
    expect(line02.journey_id).toBeNull();
    expect(line02.message).toBeNull();
    expect(line02.feature_counts).toEqual({ total: 0, done: 0, working: 0, planned: 0 });
  });

  it('总览卡片 schema keys 完整性 — 顶层字段集合恒等于约定集合（防字段漂移）', async () => {
    const res = await request(app).get('/api/staff/line-health').set(STAFF_HEADER);
    const keys = Object.keys(res.body.data[0]).sort();
    expect(keys).toEqual(
      ['availability', 'feature_counts', 'journey_id', 'journey_name', 'label', 'line_key', 'maturity', 'message', 'smoke'].sort()
    );
    expect(res.body.data[0]).not.toHaveProperty('path_key');
    expect(res.body.data[0]).not.toHaveProperty('health');
  });

  it('line04 Brain 查询 5xx/timeout 时该线 degraded，不拖垮 line01/line02', async () => {
    brainGetMock.mockImplementation((_url: string, config?: { params?: { journey_id?: string } }) => {
      if (config?.params?.journey_id === LINE04_JOURNEY_ID) {
        return Promise.reject(new Error('brain down'));
      }
      return Promise.resolve({ data: [] });
    });
    const res = await request(app).get('/api/staff/line-health').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    const line04 = res.body.data.find((d: { line_key: string }) => d.line_key === 'line04');
    expect(line04.availability).toBe('degraded');
    expect(line04.message).toContain('Brain:');
    const line01 = res.body.data.find((d: { line_key: string }) => d.line_key === 'line01');
    expect(line01.availability).toBe('not_connected');
  });

  it('无认证头访问返回 403', async () => {
    const res = await request(app).get('/api/staff/line-health');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/staff/line-health — product-map.json 降级路径 [BEHAVIOR]', () => {
  it('product-map.json 读取失败时降级为兜底清单，source=fallback 且仍返回 3 条线', async () => {
    // 只让 readFileSync 抛错，模拟文件缺失/损坏；要求实现按请求读取该文件（不是仅进程启动时读一次缓存），
    // 否则本场景无法在不重启进程的情况下测到。
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, open product-map.json');
    });
    const res = await request(app).get('/api/staff/line-health').set(STAFF_HEADER);
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(typeof res.body.fallback_reason).toBe('string');
    expect(res.body.fallback_reason.length).toBeGreaterThan(0);
    expect(res.body.data).toHaveLength(3);
  });
});

describe('GET /api/staff/line-health/:lineKey/deployment [BEHAVIOR]', () => {
  it('line04 返回三环境状态 + related_prs 恒为数组', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data.environments).toHaveLength(3);
    const envNames = res.body.data.environments.map((e: { name: string }) => e.name).sort();
    expect(envNames).toEqual(['dev', 'production', 'staging']);
    expect(Array.isArray(res.body.data.related_prs)).toBe(true);
  });

  it('production commit_sha 若非空必须匹配真实 40 位 hex 格式（Rule B，间接证明打了真实 GitHub API）', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    const production = res.body.data.environments.find((e: { name: string }) => e.name === 'production');
    if (production.commit_sha !== null) {
      expect(production.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(['active', 'not_deployed', 'unavailable']).toContain(production.status);
  });

  it('not_connected 线（line01）deployment 返回 200 空态，message 字面等于约定文案（判定点2）', async () => {
    const res = await request(app).get('/api/staff/line-health/line01/deployment').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
    expect(res.body.data.message).toBe('该业务线尚未接入 Brain 数据，暂无法展示');
    expect(res.body.data.environments).toEqual([]);
  });

  it('未知 lineKey 返回 404（不静默返回空数据）', async () => {
    const res = await request(app).get('/api/staff/line-health/bogus-line/deployment').set(STAFF_HEADER);
    expect(res.status).toBe(404);
  });

  it('无认证头返回 403', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/deployment');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/staff/line-health/:lineKey/abilities [BEHAVIOR]', () => {
  it('line04 返回 abilities 数组，每项字段齐全（id/name/status/thickness）', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/abilities').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.abilities)).toBe(true);
    for (const ability of res.body.data.abilities) {
      expect(ability).toHaveProperty('id');
      expect(ability).toHaveProperty('name');
      expect(ability).toHaveProperty('status');
      expect(ability).toHaveProperty('thickness');
    }
    expect(res.body.data.abilities.find((a: { id: string }) => a.id === 'gpb')).toBeTruthy();
  });

  it('Brain 查询失败时 abilities 返回 [] 且 message 含 Brain: 前缀（不 500）', async () => {
    brainGetMock.mockImplementation(() => Promise.reject(new Error('brain down')));
    const res = await request(app).get('/api/staff/line-health/line04/abilities').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data.abilities).toEqual([]);
    expect(res.body.data.message).toContain('Brain:');
  });

  it('not_connected 线（line02）abilities 返回 200 空数组 + 空态 message', async () => {
    const res = await request(app).get('/api/staff/line-health/line02/abilities').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
    expect(res.body.data.abilities).toEqual([]);
    expect(res.body.data.message).toBe('该业务线尚未接入 Brain 数据，暂无法展示');
  });

  it('未知 lineKey 返回 404', async () => {
    const res = await request(app).get('/api/staff/line-health/bogus-line/abilities').set(STAFF_HEADER);
    expect(res.status).toBe(404);
  });

  it('无认证头返回 403', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/abilities');
    expect(res.status).toBe(403);
  });
});

// ─── Reviewer r1 修复项1：陈旧分支判定（30 天阈值） ─────────────────────────
describe('GET /api/staff/line-health/:lineKey/deployment — 陈旧分支判定 stale vs active [BEHAVIOR]', () => {
  it('分支存在且找到匹配提交，但 commit_date 超过 30 天阈值时必须标 stale，不得标 active', async () => {
    mockGithubStaleCommit(100);
    const res = await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    githubMockOverride.handler = null;

    expect(res.status).toBe(200);
    const withCommit = res.body.data.environments.filter(
      (e: { commit_sha: string | null }) => e.commit_sha !== null
    );
    expect(withCommit.length).toBeGreaterThan(0);
    for (const env of withCommit) {
      expect(env.status).toBe('stale');
      expect(env.status).not.toBe('active');
    }
  });
});

// ─── Reviewer r1 修复项2：GitHub 数据缓存 TTL（PrepPRD 判定点6） ────────────
describe('GET /api/staff/line-health/:lineKey/deployment — GitHub 数据缓存 TTL [BEHAVIOR]', () => {
  it('短时间内两次请求同一 line04 deployment，底层 GitHub 抓取调用次数不随第二次请求增加', async () => {
    githubRealGetSpy.mockClear();
    await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    const firstCount = githubRealGetSpy.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    const secondCount = githubRealGetSpy.mock.calls.length;
    expect(secondCount).toBe(firstCount);
  });
});

// ─── Reviewer r1 修复项3：recent_commit 字段一致性 ──────────────────────────
describe('GET /api/staff/line-health/:lineKey/deployment — recent_commit 字段一致性 [BEHAVIOR]', () => {
  it('recent_commit 字段存在，且与 environments 中 production 项一致', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('recent_commit');
    const production = res.body.data.environments.find((e: { name: string }) => e.name === 'production');
    if (!production || production.commit_sha === null) {
      expect(res.body.data.recent_commit).toBeNull();
    } else {
      expect(res.body.data.recent_commit).not.toBeNull();
      expect(res.body.data.recent_commit.sha).toBe(production.commit_sha);
      expect(res.body.data.recent_commit.date).toBe(production.commit_date);
    }
  });
});

// ─── Reviewer r1 修复项4：deployment/abilities 禁用字段反向检查 ────────────
describe('deployment/abilities 端点 — 禁用字段反向检查 [BEHAVIOR]', () => {
  it('deployment 端点响应不得出现 deploy_version/version 字段', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/deployment').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('deploy_version');
    expect(res.body.data).not.toHaveProperty('version');
  });

  it('abilities 端点响应不得出现 features 字段', async () => {
    const res = await request(app).get('/api/staff/line-health/line04/abilities').set(STAFF_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('features');
  });
});
