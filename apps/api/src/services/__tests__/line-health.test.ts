/**
 * line-health 聚合层单测（业务线健康看板 GP3 / line_health）
 *
 * 覆盖：LINE_DEFS 查找 / product-map.json 真读与兜底 / staging+production 真实 /version
 *      版本读取（含不可达降级）/ recent_commit（main 上按路径过滤的最近提交，与部署状态无关）
 *      / related_prs 独立降级 / 部署摘要单槽缓存 / abilities 的 not_connected 与 Brain 故障两条分支
 *      / 待发布变更清单按 lineKey 独立缓存。
 * HTTP 层（staffGuard / 404 / JSON 包壳）由 routes/__tests__/staff.test.ts 覆盖。
 *
 * 2026-07-29 二次修正：不再用 git 分支（develop/release-cs-stable/main）猜三环境状态——
 * 那套推断本身就是错的（develop 从未被部署、release/cs-stable 与真实 staging 部署无关、
 * production 也不等于 main HEAD）。改为直接 mock apps/api 自己的 /version 端点。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: { get: axiosGetMock, isAxiosError: () => false },
}));

import {
  DEFAULT_PROD_VERSION_URL,
  DEFAULT_STAGING_VERSION_URL,
  LINE_DEFS,
  NOT_CONNECTED_MESSAGE,
  buildLineAbilities,
  buildLineDeployment,
  buildLineHealthOverview,
  clearLineHealthCache,
  findLineDef,
  loadCustomerLines,
  resolveVersionUrl,
} from '../line-health';

const LINE01 = LINE_DEFS[0];
const LINE04 = LINE_DEFS[2];

const STAGING_VERSION_URL = 'http://zenithjoy-api-staging:5200/version';
const PROD_VERSION_URL = 'http://zenithjoy-api-prod:5200/version';

const STAGING_SHA = 'a'.repeat(40);
const PROD_SHA = 'b'.repeat(40);
const RECENT_SHA = 'c'.repeat(40);

// 合成一个"未接入 Brain"的 LineDef 夹具，独立于 LINE_DEFS 真实数据。
// line01/02/04 现在都已接入真实 journey（原 Path 健康映射合并进本页面后），
// LINE_DEFS 里已经没有天然的 not_connected 样本了——但 not_connected 分支本身仍是
// 真实代码路径（product-map 未来新增无归属线时会命中），必须继续测。
const NOT_CONNECTED_LINE = {
  lineKey: 'line01' as const,
  label: 'Line 01 客户首次成功',
  journeyId: null,
  journeyName: null,
  relatedPaths: [],
  prTitleKeywords: [],
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

type GhCommitFixture = {
  sha: string;
  html_url?: string;
  commit: { message: string; author: { date: string } };
};

/** 按 URL 分派 /version（内网直连）与 GitHub commits/search 的桩 */
function stubGithub(
  opts: {
    stagingUnreachable?: boolean;
    productionUnreachable?: boolean;
    productionCommitDate?: string | null;
    recentCommitAge?: number | null;
    recentCommitFails?: boolean;
    pendingCommits?: GhCommitFixture[];
    searchFails?: boolean;
  } = {}
) {
  const {
    stagingUnreachable = false,
    productionUnreachable = false,
    productionCommitDate = isoDaysAgo(2),
    recentCommitAge = 2,
    recentCommitFails = false,
    pendingCommits = [],
    searchFails = false,
  } = opts;

  axiosGetMock.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === STAGING_VERSION_URL) {
      if (stagingUnreachable) return Promise.reject(new Error('econnrefused'));
      return Promise.resolve({ status: 200, data: { sha: STAGING_SHA, version: '1.0.1', buildTime: isoDaysAgo(1) } });
    }
    if (url === PROD_VERSION_URL) {
      if (productionUnreachable) return Promise.reject(new Error('econnrefused'));
      return Promise.resolve({ status: 200, data: { sha: PROD_SHA, version: '1.0.1', buildTime: isoDaysAgo(2) } });
    }
    if (url.includes('/journey_features')) return Promise.resolve({ status: 200, data: [] });
    if (url.includes('/search/issues')) {
      if (searchFails) return Promise.reject(new Error('search down'));
      return Promise.resolve({
        status: 200,
        data: { items: [{ number: 7, title: 'fix: x', html_url: 'u', state: 'open', updated_at: 't' }] },
      });
    }
    // 单条 commit 查询（fetchCommitDate）：URL 形如 .../commits/<sha>
    if (/\/commits\/[0-9a-z]+$/.test(url)) {
      if (productionCommitDate === null) return Promise.reject(new Error('commit not found'));
      return Promise.resolve({ status: 200, data: { commit: { author: { date: productionCommitDate } } } });
    }
    // 分支提交列表：URL 形如 .../commits（sha/path/since 走 query params）
    if (url.endsWith('/commits')) {
      const params = config?.params ?? {};
      if (params.since) {
        return Promise.resolve({ status: 200, data: pendingCommits });
      }
      if (recentCommitFails) return Promise.reject(new Error('commits list down'));
      if (recentCommitAge === null) return Promise.resolve({ status: 200, data: [] });
      return Promise.resolve({
        status: 200,
        data: [
          {
            sha: RECENT_SHA,
            html_url: `https://github.com/x/y/commit/${RECENT_SHA}`,
            commit: { message: 'feat: recent change', author: { date: isoDaysAgo(recentCommitAge) } },
          },
        ],
      });
    }
    return Promise.resolve({ status: 200, data: {} });
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

// 2026-07-29 真机 bug（真实 staging 部署验证发现）：staging/production 默认地址曾写成
// http://localhost:5201 / http://localhost:5200。hk-vps 上这两个 apps/api 实例是 zenithjoy-net
// 桥接网络里两个独立容器（zenithjoy-api-staging / zenithjoy-api-prod），彼此网络命名空间隔离——
// "localhost" 从任一容器内部发出永远只指向"处理这次请求的那个容器自己"，够不着兄弟容器。
// 实测复现：无论请求落在哪个容器，"staging" 那次查询必连不上（该容器内部根本没监听 5201），
// "production" 那次其实打的是容器自己（两个容器内部都用 PORT=5200 监听），于是把"自己的版本"
// 误标成了"production"。必须用 Docker 内置 DNS 按容器名跨容器互访，回归守卫钉死默认值不许
// 再退回 localhost。
describe('staging/production 默认地址必须是容器名（不是 localhost）——真机 bug 回归守卫', () => {
  it('默认地址必须走 Docker 容器名 DNS，不得是 localhost（localhost 在桥接网络里只指向自己，够不着兄弟容器）', () => {
    expect(DEFAULT_STAGING_VERSION_URL).toBe('http://zenithjoy-api-staging:5200/version');
    expect(DEFAULT_PROD_VERSION_URL).toBe('http://zenithjoy-api-prod:5200/version');
    expect(DEFAULT_STAGING_VERSION_URL).not.toContain('localhost');
    expect(DEFAULT_PROD_VERSION_URL).not.toContain('localhost');
  });
});

describe('resolveVersionUrl — env 覆盖必须是合法 http(s) URL，否则落回默认值', () => {
  const FALLBACK = 'http://localhost:5200/version';

  it('未设置 env → 直接用默认值', () => {
    expect(resolveVersionUrl(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('合法 http(s) URL → 原样使用', () => {
    expect(resolveVersionUrl('http://10.0.0.5:5200/version', FALLBACK)).toBe('http://10.0.0.5:5200/version');
    expect(resolveVersionUrl('https://internal.example.com/version', FALLBACK)).toBe(
      'https://internal.example.com/version'
    );
  });

  it('不是合法 URL（手滑填了随意字符串）→ 落回默认值，不带着垃圾地址去发请求', () => {
    expect(resolveVersionUrl('not a url', FALLBACK)).toBe(FALLBACK);
    expect(resolveVersionUrl('', FALLBACK)).toBe(FALLBACK);
  });

  it('非 http(s) 协议（如 file://）→ 落回默认值', () => {
    expect(resolveVersionUrl('file:///etc/passwd', FALLBACK)).toBe(FALLBACK);
    expect(resolveVersionUrl('ftp://internal/version', FALLBACK)).toBe(FALLBACK);
  });
});

describe('LINE_DEFS / findLineDef', () => {
  it('只认 line01/line02/line04 三条对外业务线，其余返回 null', () => {
    expect(LINE_DEFS.map((d) => d.lineKey)).toEqual(['line01', 'line02', 'line04']);
    expect(findLineDef('line04')?.journeyId).toBe('e675da0f-1117-4301-a801-cd4753beb8c8');
    expect(findLineDef('line01')?.journeyId).toBe('c019cdeb-d90b-4f8b-a658-ae333663ac35');
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
  // 回归守卫：line01/02/04 三条线必须都带真实 journeyId（原 Path 健康 PATH_DEFS 的
  // path1/path2/path4 映射，合并进本页面时曾一度被漏写成 journeyId:null，导致业务线
  // 健康看板显示"未接入"而实际上 Brain 里有数据——不允许静默回退）。
  it('三条线均已接入真实 journey，source=product_map，无一条落回 not_connected', async () => {
    const overview = await buildLineHealthOverview();
    expect(overview.source).toBe('product_map');
    expect(overview.fallback_reason).toBeNull();
    expect(overview.data).toHaveLength(3);

    for (const item of overview.data) {
      expect(item.journey_id).not.toBeNull();
      expect(item.availability).not.toBe('not_connected');
    }

    const [line01, line02, line04] = overview.data;
    expect(line01.journey_id).toBe('c019cdeb-d90b-4f8b-a658-ae333663ac35');
    expect(line02.journey_id).toBe('afa6abca-53c0-4815-8594-b7fb81ca547f');
    expect(line04.journey_id).toBe('e675da0f-1117-4301-a801-cd4753beb8c8');
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

describe('buildLineDeployment — 真实 /version（不再猜 git 分支）', () => {
  it('未接入线不打任何网络请求，直接返回空态与约定文案', async () => {
    const data = await buildLineDeployment(NOT_CONNECTED_LINE);
    expect(data.connected).toBe(false);
    expect(data.message).toBe(NOT_CONNECTED_MESSAGE);
    expect(data.staging).toEqual({ sha: null, version: null, build_time: null });
    expect(data.production).toEqual({ sha: null, version: null, build_time: null });
    expect(data.recent_commit).toBeNull();
    expect(data.related_prs).toEqual([]);
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it('staging/production 直接反映 apps/api /version 真实返回值，recent_commit 取 main 上最近相关提交（与部署状态无关）', async () => {
    const data = await buildLineDeployment(LINE04);
    expect(data.staging.sha).toBe(STAGING_SHA);
    expect(data.production.sha).toBe(PROD_SHA);
    expect(data.production.version).toBe('1.0.1');
    expect(data.recent_commit?.sha).toBe(RECENT_SHA);
    expect(data.related_prs).toHaveLength(1);
  });

  it('/version 不可达时该环境 sha/version/build_time 全为 null（不是抛异常、不是假数据）', async () => {
    clearLineHealthCache();
    stubGithub({ stagingUnreachable: true });
    const data = await buildLineDeployment(LINE04);
    expect(data.staging).toEqual({ sha: null, version: null, build_time: null });
    expect(data.production.sha).toBe(PROD_SHA);
  });

  it('/version 返回非 2xx 错误状态（真实 axios 对非 2xx 默认 reject）时同样降级为 null，不抛异常、不解析错误响应体', async () => {
    clearLineHealthCache();
    axiosGetMock.mockImplementation((url: string) => {
      if (url === STAGING_VERSION_URL) return Promise.reject(new Error('Request failed with status code 503'));
      if (url === PROD_VERSION_URL) {
        return Promise.resolve({ status: 200, data: { sha: PROD_SHA, version: '1.0.1', buildTime: isoDaysAgo(2) } });
      }
      if (/\/commits\/[0-9a-z]+$/.test(url)) return Promise.resolve({ status: 200, data: { commit: { author: { date: isoDaysAgo(2) } } } });
      if (url.includes('/search/issues')) return Promise.resolve({ status: 200, data: { items: [] } });
      if (url.endsWith('/commits')) return Promise.resolve({ status: 200, data: [] });
      return Promise.resolve({ status: 200, data: {} });
    });
    const data = await buildLineDeployment(LINE04);
    expect(data.staging).toEqual({ sha: null, version: null, build_time: null });
    expect(data.production.sha).toBe(PROD_SHA);
  });

  it('/version 返回 200 但响应体缺字段（如 build-info.json 用兜底值 "unknown"）时对外呈现为 null，不把字面量 "unknown" 当真实 sha', async () => {
    clearLineHealthCache();
    axiosGetMock.mockImplementation((url: string) => {
      if (url === STAGING_VERSION_URL) return Promise.resolve({ status: 200, data: { sha: 'unknown', version: 'unknown', buildTime: 'unknown' } });
      if (url === PROD_VERSION_URL) {
        return Promise.resolve({ status: 200, data: { sha: PROD_SHA, version: '1.0.1', buildTime: isoDaysAgo(2) } });
      }
      if (/\/commits\/[0-9a-z]+$/.test(url)) return Promise.resolve({ status: 200, data: { commit: { author: { date: isoDaysAgo(2) } } } });
      if (url.includes('/search/issues')) return Promise.resolve({ status: 200, data: { items: [] } });
      if (url.endsWith('/commits')) return Promise.resolve({ status: 200, data: [] });
      return Promise.resolve({ status: 200, data: {} });
    });
    const data = await buildLineDeployment(LINE04);
    expect(data.staging).toEqual({ sha: null, version: null, build_time: null });
  });

  it('GitHub search 故障时 related_prs 独立降级为 []，不影响 staging/production 读取', async () => {
    clearLineHealthCache();
    stubGithub({ searchFails: true });
    const data = await buildLineDeployment(LINE04);
    expect(data.related_prs).toEqual([]);
    expect(data.production.sha).toBe(PROD_SHA);
  });

  it('缓存命中：同一条线连续两次请求只打一轮外部调用；切到另一条线即释放槽位', async () => {
    await buildLineDeployment(LINE04);
    const firstCount = axiosGetMock.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    await buildLineDeployment(LINE04);
    expect(axiosGetMock.mock.calls.length).toBe(firstCount);

    // 切到一条未接入线（占用单槽，不打任何请求），再切回 line04 → 必须重新抓取
    await buildLineDeployment(NOT_CONNECTED_LINE);
    await buildLineDeployment(LINE04);
    expect(axiosGetMock.mock.calls.length).toBeGreaterThan(firstCount);
  });

  it('staging/production 与 related_prs 全部拿不到真实数据时不写缓存，下次仍重新抓取（故障态不钉死）', async () => {
    clearLineHealthCache();
    stubGithub({ stagingUnreachable: true, productionUnreachable: true, recentCommitFails: true, searchFails: true });
    await buildLineDeployment(LINE04);
    const firstCount = axiosGetMock.mock.calls.length;
    await buildLineDeployment(LINE04);
    expect(axiosGetMock.mock.calls.length).toBe(firstCount * 2);
  });
});

describe('buildLineAbilities', () => {
  it('未接入线返回 connected=false + 空数组 + 约定文案，不打 Brain', async () => {
    const data = await buildLineAbilities(NOT_CONNECTED_LINE);
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

// 2026-07-29 用户拍板：总览卡片去掉不可靠的 smoke 匹配，改成版本概览 + 待发布变更清单
// 2026-07-29 二次修正：版本概览改用真实 /version（不再用 git 分支猜），且 staging/production
// 是三条线共享的一份部署摘要（同一个 apps/api），不再挂在每条 LineHealthItem 上。
describe('buildLineHealthOverview — 共享部署摘要 + 待发布变更清单', () => {
  it('总览顶层带 deployment（staging/production 真实 sha），每条 item 不再有 environments/smoke 字段', async () => {
    const overview = await buildLineHealthOverview();
    expect(overview.deployment.staging.sha).toBe(STAGING_SHA);
    expect(overview.deployment.production.sha).toBe(PROD_SHA);

    const line04 = overview.data.find((d) => d.line_key === 'line04')!;
    expect(line04).not.toHaveProperty('smoke');
    expect(line04).not.toHaveProperty('environments');
  });

  it('Brain 返回空数组（非错误）时 availability=ready，不再因"无 smoke 匹配"而 degraded', async () => {
    const overview = await buildLineHealthOverview();
    const line01 = overview.data.find((d) => d.line_key === 'line01')!;
    expect(line01.availability).toBe('ready');
    expect(line01.message).toBeNull();
  });

  it('pending_changes：main 分支上比 production 更新、命中相关路径的提交才计入，production 自身提交被排除', async () => {
    const NEW_SHA = 'd'.repeat(40);
    stubGithub({
      pendingCommits: [
        {
          sha: NEW_SHA,
          html_url: `https://github.com/x/y/commit/${NEW_SHA}`,
          commit: { message: 'feat(line04): 新功能\n\n详细说明另起一行', author: { date: isoDaysAgo(1) } },
        },
        {
          sha: PROD_SHA,
          html_url: `https://github.com/x/y/commit/${PROD_SHA}`,
          commit: { message: 'feat: prod baseline', author: { date: isoDaysAgo(2) } },
        },
      ],
    });

    const overview = await buildLineHealthOverview();
    const line04 = overview.data.find((d) => d.line_key === 'line04')!;
    expect(line04.pending_changes).toHaveLength(1);
    expect(line04.pending_changes[0].sha).toBe(NEW_SHA);
    expect(line04.pending_changes[0].message).toBe('feat(line04): 新功能'); // 只取首行，不含提交详细说明
    expect(line04.pending_changes.some((c) => c.sha === PROD_SHA)).toBe(false);
  });

  it('production /version 不可达（拿不到 sha）时 pending_changes 为空，不发起 since 查询', async () => {
    stubGithub({ productionUnreachable: true });

    const overview = await buildLineHealthOverview();
    const line04 = overview.data.find((d) => d.line_key === 'line04')!;
    expect(line04.pending_changes).toEqual([]);
    const sinceCalls = axiosGetMock.mock.calls.filter(
      ([url, config]) => String(url).endsWith('/commits') && (config as { params?: Record<string, unknown> })?.params?.since
    );
    expect(sinceCalls).toHaveLength(0);
  });

  it('总览待发布变更清单按 lineKey 各自独立缓存（不是单槽）：连续拉取三条线互不驱逐', async () => {
    const countGithubCalls = () =>
      axiosGetMock.mock.calls.filter(([url]: [string]) => String(url).endsWith('/commits') || String(url).includes('/search/issues')).length;

    await buildLineHealthOverview();
    const firstCount = countGithubCalls();
    expect(firstCount).toBeGreaterThan(0);

    await buildLineHealthOverview();
    // 三条线的待发布变更清单 + 共享部署摘要都命中各自缓存 → 第二次总览请求不应再发起额外调用
    // （journey_features 走 Brain，本模块不缓存，不计入本断言）
    expect(countGithubCalls()).toBe(firstCount);
  });
});
