/**
 * line-health 聚合层单测（业务线健康看板 GP3 / line_health）
 *
 * 覆盖：LINE_DEFS 查找 / product-map.json 真读与兜底 / 三环境四态判定与 30 天陈旧阈值 /
 *      recent_commit 与 production 一致 / related_prs 独立降级 / GitHub 单槽缓存 /
 *      abilities 的 not_connected 与 Brain 故障两条分支。
 * HTTP 层（staffGuard / 404 / JSON 包壳）由 routes/__tests__/staff.test.ts 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: { get: axiosGetMock, isAxiosError: () => false },
}));

import {
  LINE_DEFS,
  NOT_CONNECTED_MESSAGE,
  STALE_THRESHOLD_DAYS,
  buildLineAbilities,
  buildLineDeployment,
  buildLineHealthOverview,
  clearLineHealthCache,
  findLineDef,
  loadCustomerLines,
} from '../line-health';

const LINE01 = LINE_DEFS[0];
const LINE04 = LINE_DEFS[2];
const SHA = 'c'.repeat(40);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** 按 URL 分派 Brain / commits / search / actions runs 的桩 */
function stubGithub(opts: { commitDays?: Record<string, number | null>; searchFails?: boolean; noStatus?: boolean } = {}) {
  const commitDays = opts.commitDays ?? { develop: null, 'release/cs-stable': 90, main: 2 };
  axiosGetMock.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url.includes('/journey_features')) return Promise.resolve({ status: 200, data: [] });
    if (url.includes('/search/issues')) {
      if (opts.searchFails) return Promise.reject(new Error('search down'));
      return Promise.resolve({ status: 200, data: { items: [{ number: 7, title: 'fix: x', html_url: 'u', state: 'open', updated_at: 't' }] } });
    }
    if (url.includes('/commits')) {
      const branch = String(config?.params?.sha ?? '');
      const age = commitDays[branch];
      if (age === undefined) return Promise.reject(new Error('404 branch'));
      const status = opts.noStatus ? undefined : 200;
      if (age === null) return Promise.resolve({ status, data: [] });
      return Promise.resolve({
        status,
        data: [{ sha: SHA, html_url: `https://github.com/x/y/commit/${SHA}`, commit: { message: 'feat: x', author: { date: isoDaysAgo(age) } } }],
      });
    }
    return Promise.resolve({ status: 200, data: { workflow_runs: [] } });
  });
}

beforeEach(() => {
  axiosGetMock.mockReset();
  clearLineHealthCache();
  stubGithub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearLineHealthCache();
});

describe('LINE_DEFS / findLineDef', () => {
  it('只认 line01/line02/line04 三条对外业务线，其余返回 null', () => {
    expect(LINE_DEFS.map((d) => d.lineKey)).toEqual(['line01', 'line02', 'line04']);
    expect(findLineDef('line04')?.journeyId).toBe('e675da0f-1117-4301-a801-cd4753beb8c8');
    expect(findLineDef('line01')?.journeyId).toBeNull();
    expect(findLineDef('line03')).toBeNull();
    expect(findLineDef('')).toBeNull();
  });
});

describe('loadCustomerLines — product-map.json 权威清单', () => {
  it('真读仓库内 product-map.json，拿到 customer_app 的三条业务线', () => {
    const { lines, error } = loadCustomerLines();
    expect(error).toBeNull();
    expect(lines?.map((l) => l.id).sort()).toEqual(['line01', 'line02', 'line04']);
  });

  it('文件路径不存在时返回 error 而非抛异常（供上层兜底）', () => {
    vi.stubEnv('PRODUCT_MAP_PATH', '/definitely/not/here/product-map.json');
    const { lines, error } = loadCustomerLines();
    expect(lines).toBeNull();
    expect(error).toContain('product-map.json 读取或解析失败');
  });
});

describe('buildLineHealthOverview', () => {
  it('未接入线固定 not_connected 且 feature_counts 全 0，source=product_map', async () => {
    const overview = await buildLineHealthOverview();
    expect(overview.source).toBe('product_map');
    expect(overview.fallback_reason).toBeNull();
    expect(overview.data).toHaveLength(3);

    const line02 = overview.data[1];
    expect(line02.availability).toBe('not_connected');
    expect(line02.maturity).toBe('not_connected');
    expect(line02.journey_id).toBeNull();
    expect(line02.feature_counts).toEqual({ total: 0, done: 0, working: 0, planned: 0 });
    expect(line02.smoke).toBeNull();
  });

  it('product-map 不可读时 source=fallback，但仍用内置 LINE_DEFS 返回 3 条线', async () => {
    vi.stubEnv('PRODUCT_MAP_PATH', '/definitely/not/here/product-map.json');
    const overview = await buildLineHealthOverview();
    expect(overview.source).toBe('fallback');
    expect(typeof overview.fallback_reason).toBe('string');
    expect(overview.data).toHaveLength(3);
    expect(overview.data[0].label).toBe(LINE01.label);
  });
});

describe('buildLineDeployment', () => {
  it('未接入线不打 GitHub，直接返回空态与约定文案', async () => {
    const data = await buildLineDeployment(LINE01);
    expect(data.connected).toBe(false);
    expect(data.message).toBe(NOT_CONNECTED_MESSAGE);
    expect(data.environments).toEqual([]);
    expect(data.recent_commit).toBeNull();
    expect(data.related_prs).toEqual([]);
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it('三环境四态互斥：空提交=not_deployed、超阈值=stale、阈值内=active', async () => {
    const data = await buildLineDeployment(LINE04);
    const byName = Object.fromEntries(data.environments.map((e) => [e.name, e]));
    expect(byName.dev.status).toBe('not_deployed');
    expect(byName.dev.commit_sha).toBeNull();
    expect(byName.staging.status).toBe('stale');
    expect(byName.staging.commit_sha).toBe(SHA);
    expect(byName.production.status).toBe('active');
    expect(data.recent_commit?.sha).toBe(byName.production.commit_sha);
    expect(data.recent_commit?.date).toBe(byName.production.commit_date);
    expect(data.related_prs).toHaveLength(1);
  });

  it(`陈旧阈值 ${STALE_THRESHOLD_DAYS} 天边界：刚好超过一天标 stale，刚好差一天仍 active`, async () => {
    clearLineHealthCache();
    stubGithub({ commitDays: { develop: STALE_THRESHOLD_DAYS + 1, 'release/cs-stable': STALE_THRESHOLD_DAYS - 1, main: 1 } });
    const data = await buildLineDeployment(LINE04);
    const byName = Object.fromEntries(data.environments.map((e) => [e.name, e]));
    expect(byName.dev.status).toBe('stale');
    expect(byName.staging.status).toBe('active');
  });

  it('GitHub 查询失败标 unavailable（区别于 not_deployed），related_prs 独立降级为 []', async () => {
    clearLineHealthCache();
    stubGithub({ commitDays: { main: 1 }, searchFails: true });
    const data = await buildLineDeployment(LINE04);
    const byName = Object.fromEntries(data.environments.map((e) => [e.name, e]));
    expect(byName.dev.status).toBe('unavailable');
    expect(byName.dev.commit_sha).toBeNull();
    expect(byName.production.status).toBe('active');
    expect(data.related_prs).toEqual([]);
  });

  it('缓存命中：同一条线连续两次请求只打一轮 GitHub；切到另一条线即释放槽位', async () => {
    await buildLineDeployment(LINE04);
    const firstCount = axiosGetMock.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    await buildLineDeployment(LINE04);
    expect(axiosGetMock.mock.calls.length).toBe(firstCount);

    // 切到 line01（未接入，占用单槽），再切回 line04 → 必须重新抓取
    await buildLineDeployment(LINE01);
    await buildLineDeployment(LINE04);
    expect(axiosGetMock.mock.calls.length).toBeGreaterThan(firstCount);
  });

  it('全部 GitHub 调用都不是真实 200 响应时不写缓存，下次仍重新抓取（故障态不钉死 5 分钟）', async () => {
    clearLineHealthCache();
    stubGithub({ noStatus: true, searchFails: true });
    await buildLineDeployment(LINE04);
    const firstCount = axiosGetMock.mock.calls.length;
    await buildLineDeployment(LINE04);
    expect(axiosGetMock.mock.calls.length).toBe(firstCount * 2);
  });
});

describe('buildLineAbilities', () => {
  it('未接入线返回 connected=false + 空数组 + 约定文案，不打 Brain', async () => {
    const data = await buildLineAbilities(LINE01);
    expect(data.connected).toBe(false);
    expect(data.abilities).toEqual([]);
    expect(data.message).toBe(NOT_CONNECTED_MESSAGE);
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it('接入线映射 Brain 能力字段，缺省字段补 unknown/feature', async () => {
    axiosGetMock.mockResolvedValue({ status: 200, data: [{ id: 'a1', name: '能力1' }] });
    const data = await buildLineAbilities(LINE04);
    expect(data.connected).toBe(true);
    expect(data.message).toBeNull();
    expect(data.abilities[0]).toEqual({
      id: 'a1',
      name: '能力1',
      status: 'unknown',
      thickness: 'unknown',
      kind: 'feature',
      updated_at: null,
    });
  });

  it('Brain 故障时返回空数组 + "Brain:" 前缀 message，不抛异常', async () => {
    axiosGetMock.mockRejectedValue(new Error('brain down'));
    const data = await buildLineAbilities(LINE04);
    expect(data.abilities).toEqual([]);
    expect(data.message).toContain('Brain:');
    expect(data.message).toContain('brain down');
  });
});
