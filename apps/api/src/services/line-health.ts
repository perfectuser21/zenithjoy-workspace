/**
 * 业务线健康看板（GP3 / line_health）聚合层
 *
 * 对应 sprint 07281207-staff-line-health-dashboard 合同：
 *   GET /api/staff/line-health                      — 总览三张业务线卡片
 *   GET /api/staff/line-health/:lineKey/deployment  — 详情页「部署」tab
 *   GET /api/staff/line-health/:lineKey/abilities   — 详情页「能力」tab
 *
 * 三条对外业务线（line01/line02/line04）清单以 product-map/generated/product-map.json
 * 的 customer_app.lines 为权威来源；journeyId / 相关路径 / PR 标题关键词等映射本 sprint
 * 硬编码在 LINE_DEFS（product-map 当前无 owned_paths 字段，不做重复维护的第二份路径映射）。
 *
 * journeyId 取值与已下线的「Path 健康」页面（原 PATH_DEFS）保持一致（line01=Path1=智能发布
 * journey c019cdeb，line02=Path2=客户智能获客路径 journey afa6abca，line04=Path4=智能客服
 * journey e675da0f）——两个页面本是同一件事，Path 健康已合并进本页面并删除。
 *
 * 判定点（详见 contract-draft.md 判定点登记表）：
 *   1. journeyId 为 null 时该线走 "not_connected" 态（字面区分，不靠 0/0 反推）——
 *      当前 line01/02/04 均已接入 Brain，此分支保留给未来 product-map 新增无归属线的场景
 *   2. Brain 故障 → "degraded" + "Brain:" 前缀消息，HTTP 仍 200
 *   3. "关联 PR" = GitHub Search Issues 按标题关键词匹配（接受稀疏结果）
 *   4. 降级粒度 = 按字段独立（部署摘要 / related_prs / abilities 各自独立降级）
 *   5. GitHub 数据缓存 5 分钟（未认证 60 次/小时限额，多员工同开会打满）
 *
 * 2026-07-29 用户拍板 #1：总览卡片去掉 smoke 状态（workflow name 匹配逻辑天然不可靠——
 * golden-path-N-smoke.sh 常是塞进别的大 workflow 里跑的一个步骤，GitHub API 只能看到
 * 外层 workflow 名字，永远匹配不上），改成三环境版本号 + 待发布变更清单。
 *
 * 2026-07-29 事后发现并修正 #2：上一版"三环境版本"本身也是错的——用 git 分支去猜
 * 部署状态是另一种不可靠的推断：
 *   - "dev" 对应 develop 分支，但该分支自 2026-03-07 起从未被任何 workflow 部署过，
 *     纯属死概念，界面上不该出现"三环境"。
 *   - "staging" 曾对应 release/cs-stable 分支，但该分支自 2026-06-23 起同样无人维护，
 *     跟真实 staging 部署毫无关系（真实触发：push main 改 apps/api/** →
 *     deploy-staging-hk.yml 自动部署 hk-vps :5201）。
 *   - "production" 曾对应 main 分支 HEAD，这也是错的——production 走 promote-prod-hk.yml
 *     人工点选任意 SHA 推送，跟 main 当前指向没有必然关系（人工卡点的意义就是让它可以滞后）。
 *   - 三条业务线（line01/02/04）背后其实是同一个 apps/api 部署，不存在"各自独立的版本"。
 * 正确数据源：apps/api 自带的 /version 端点（build-info.ts，构建时把 git sha 写入
 * dist/build-info.json，进程启动后原样暴露）——直接问"正在跑的进程是哪个 commit"，
 * 而不是从 git 历史反推。staging/production 版本作为全局共享信息只在总览页顶部展示一次；
 * "待发布变更清单"则用该 sha 的真实提交时间作 since 过滤，按各线相关路径统计。
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import {
  JourneyFeature,
  fetchJourneyFeatures,
  githubHeaders,
  githubRepo,
  maturityFromCounts,
} from './staff-health';

/** 判定点 1：未接入业务线的空态文案（前端直接渲染，不重新措辞） */
export const NOT_CONNECTED_MESSAGE = '该业务线尚未接入 Brain 数据，暂无法展示';

/** 判定点 5：GitHub 数据缓存 TTL */
const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000;

/** apps/api 自身 /version 端点是内网直连（同机 docker/localhost），缓存 TTL 远短于 GitHub 那档 */
const DEPLOYMENT_SUMMARY_TTL_MS = 30 * 1000;
const LIVE_VERSION_TIMEOUT_MS = 5000;

/**
 * env 覆盖必须是合法 http(s) URL，否则忽略并落回默认值——避免一个手滑的错误配置
 * （比如误填了非 URL 字符串）导致后续 axios.get 用一个奇怪的地址发起请求。
 */
export function resolveVersionUrl(envValue: string | undefined, fallback: string): string {
  if (!envValue) return fallback;
  try {
    const parsed = new URL(envValue);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    return envValue;
  } catch {
    return fallback;
  }
}

const STAGING_VERSION_URL = resolveVersionUrl(process.env.LINE_HEALTH_STAGING_VERSION_URL, 'http://localhost:5201/version');
const PROD_VERSION_URL = resolveVersionUrl(process.env.LINE_HEALTH_PROD_VERSION_URL, 'http://localhost:5200/version');

export type LineKey = 'line01' | 'line02' | 'line04';

export type LineDef = {
  lineKey: LineKey;
  label: string;
  /** null = 尚未接入 Brain（line01/line02），压根不发起 Brain 请求 */
  journeyId: string | null;
  journeyName: string | null;
  /** 按路径过滤"最近相关提交"/"待发布变更清单"用；thin 阶段每条线取首个代表路径 */
  relatedPaths: string[];
  prTitleKeywords: string[];
};

export const LINE_DEFS: LineDef[] = [
  {
    lineKey: 'line01',
    label: 'Line 01 客户首次成功',
    // 原 Path 健康 PATH_DEFS 的 path1 映射（智能发布 journey），Path 健康已下线合并进本页面
    journeyId: 'c019cdeb-d90b-4f8b-a658-ae333663ac35',
    journeyName: '智能发布',
    relatedPaths: ['apps/api/src/routes/publish.ts'],
    prTitleKeywords: ['line01', 'path1'],
  },
  {
    lineKey: 'line02',
    label: 'Line 02 客户智能获客',
    // 原 Path 健康 PATH_DEFS 的 path2 映射（客户智能获客路径 journey），Path 健康已下线合并进本页面
    journeyId: 'afa6abca-53c0-4815-8594-b7fb81ca547f',
    journeyName: '客户智能获客路径',
    relatedPaths: ['apps/api/src/routes/acquisition.ts'],
    prTitleKeywords: ['line02', 'acquisition'],
  },
  {
    lineKey: 'line04',
    label: 'Line 04 客户私域 AI 接管',
    // PR #1487 修复后的整合版"智能客服" journey，不得回退到已废弃孤儿 journey
    journeyId: 'e675da0f-1117-4301-a801-cd4753beb8c8',
    journeyName: '智能客服',
    relatedPaths: ['apps/api/src/routes/wechat.ts', 'apps/api/src/services/wechat'],
    prTitleKeywords: ['wechat'],
  },
];

/** apps/api /version 端点的原样透传；sha/version/build_time 全 null = 该环境不可达或未知 */
export type LiveVersion = {
  sha: string | null;
  version: string | null;
  build_time: string | null;
};

/** 总览页顶部的共享部署摘要——staging/production 对三条业务线都是同一份数据 */
export type LineHealthDeploymentSummary = {
  staging: LiveVersion;
  production: LiveVersion;
};

export type LineRecentCommit = {
  sha: string;
  message: string;
  date: string | null;
  url: string;
};

export type LineRelatedPr = {
  number: number;
  title: string;
  url: string;
  state: string;
  updated_at: string | null;
};

/** main 分支上、production 当前版本之后新增、命中该线相关路径的提交（"待发布变更清单"） */
export type LinePendingChange = {
  sha: string;
  message: string;
  url: string;
  date: string | null;
};

export type LineDeployment = {
  line_key: string;
  connected: boolean;
  message: string | null;
  staging: LiveVersion;
  production: LiveVersion;
  /** main 上按本线相关路径过滤的最近一次提交——描述"代码最近改到哪"，不代表已部署 */
  recent_commit: LineRecentCommit | null;
  related_prs: LineRelatedPr[];
};

export type LineAbility = {
  id: string;
  name: string;
  status: string;
  thickness: string;
  kind: string;
  updated_at: string | null;
};

export type LineAbilities = {
  line_key: string;
  connected: boolean;
  message: string | null;
  abilities: LineAbility[];
};

export type LineHealthItem = {
  line_key: string;
  label: string;
  journey_id: string | null;
  journey_name: string | null;
  maturity: string;
  availability: 'ready' | 'degraded' | 'not_connected';
  message: string | null;
  feature_counts: { total: number; done: number; working: number; planned: number };
  /** production 相对 main 的待发布变更清单，未接入线为空数组 */
  pending_changes: LinePendingChange[];
};

export type LineHealthOverview = {
  data: LineHealthItem[];
  /** 三条线共享的部署摘要（同一个 apps/api 部署），只在总览页展示一次 */
  deployment: LineHealthDeploymentSummary;
  source: 'product_map' | 'fallback';
  fallback_reason: string | null;
};

export function findLineDef(lineKey: string): LineDef | null {
  return LINE_DEFS.find((def) => def.lineKey === lineKey) ?? null;
}

// ─── product-map.json（业务线清单权威来源）────────────────────────────────────

function productMapCandidates(): string[] {
  const fromEnv = process.env.PRODUCT_MAP_PATH;
  if (fromEnv) return [fromEnv];
  // apps/api 既可能从仓库根跑（vitest/sprint 合同测试），也可能从 apps/api 跑（npm start / CI），
  // 因此按 cwd 逐级向上找，不依赖 __dirname（打包/ESM 转译下不稳定）。
  return [
    'product-map/generated/product-map.json',
    '../../product-map/generated/product-map.json',
    '../../../product-map/generated/product-map.json',
  ].map((rel) => path.resolve(process.cwd(), rel));
}

/**
 * 每次请求真读一次 product-map.json（不是进程启动读一次永久缓存）——
 * 否则"文件缺失/损坏 → 全页兜底 + banner"这条降级路径在不重启进程时无法验证。
 */
export function loadCustomerLines(): { lines: Array<{ id: string; name: string }> | null; error: string | null } {
  let lastError = 'product-map.json 未找到';
  for (const candidate of productMapCandidates()) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      const apps = Array.isArray(parsed?.apps) ? parsed.apps : [];
      const customerApp = apps.find((app: { id?: string }) => app?.id === 'customer_app');
      const lines = Array.isArray(customerApp?.lines) ? customerApp.lines : [];
      if (lines.length === 0) throw new Error('customer_app.lines 为空');
      return { lines, error: null };
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return { lines: null, error: `product-map.json 读取或解析失败: ${lastError}` };
}

// ─── GitHub 抓取 + 缓存（判定点 5）──────────────────────────────────────────

type GhOk<T> = { ok: true; data: T; status: number };
type GhErr = { ok: false; error: string };
type GhResult<T> = GhOk<T> | GhErr;

async function githubGet<T>(url: string, params: Record<string, unknown>): Promise<GhResult<T>> {
  try {
    const resp = await axios.get(url, { headers: githubHeaders(), params, timeout: 20000 });
    return {
      ok: true,
      data: resp?.data as T,
      status: typeof resp?.status === 'number' ? resp.status : 0,
    };
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : 'github unavailable';
    return { ok: false, error: message };
  }
}

/**
 * 缓存写入前提：本次请求确实从 GitHub 成功拿到过数据（至少一个真实 HTTP 200 响应）。
 * 全部失败（限流/网络故障）不写缓存，避免把一次故障态钉死 5 分钟——失败语义要求下次请求重试。
 */
type SingleSlotCache<T> = { key: string; value: T; expiresAt: number } | null;

/**
 * deployment 单槽缓存（maxEntries = 1）。员工详情页的真实使用模式是"反复看同一条线"
 * （部署/能力 tab 来回切、返回总览再进同一条），单槽即可吃掉绝大部分重复 GitHub 调用；
 * 切换到另一条业务线立刻释放上一槽，保证不会长期持有陈旧部署信息、内存也恒定有界。
 */
let deploymentCache: SingleSlotCache<LineDeployment> = null;

/** 总览页"待发布变更清单"缓存——按 lineKey 分别持有一份（总览一次要同时展示三条线，单槽会互相驱逐）。 */
const pendingChangesCache = new Map<string, { value: LinePendingChange[]; expiresAt: number }>();

function readPendingChanges(lineKey: string): LinePendingChange[] | null {
  const slot = pendingChangesCache.get(lineKey);
  if (slot && Date.now() < slot.expiresAt) return slot.value;
  return null;
}

function writePendingChanges(lineKey: string, value: LinePendingChange[]): void {
  pendingChangesCache.set(lineKey, { value, expiresAt: Date.now() + GITHUB_CACHE_TTL_MS });
}

type DeploymentSummaryInternal = {
  summary: LineHealthDeploymentSummary;
  /** production sha 对应的真实提交时间，供"待发布变更清单"的 since 过滤用，不对外暴露 */
  productionCommitDate: string | null;
};

let deploymentSummaryCache: { value: DeploymentSummaryInternal; expiresAt: number } | null = null;

/** 仅供测试/运维排障使用：清空 line-health 的全部缓存（GitHub + 部署摘要） */
export function clearLineHealthCache(): void {
  deploymentCache = null;
  pendingChangesCache.clear();
  deploymentSummaryCache = null;
}

function readSlot<T>(slot: SingleSlotCache<T>, key: string): { hit: true; value: T } | { hit: false } {
  if (slot && slot.key === key && Date.now() < slot.expiresAt) {
    return { hit: true, value: slot.value };
  }
  return { hit: false };
}

function makeSlot<T>(key: string, value: T): SingleSlotCache<T> {
  return { key, value, expiresAt: Date.now() + GITHUB_CACHE_TTL_MS };
}

type GhCommit = {
  sha?: string;
  html_url?: string;
  commit?: { message?: string; author?: { date?: string }; committer?: { date?: string } };
};

type GhSearchItem = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  updated_at?: string;
};

/** apps/api 自己的 /version 端点——直接问"正在跑的进程是哪个 build"，零 git 历史推断。 */
async function fetchLiveVersion(url: string): Promise<LiveVersion> {
  try {
    const resp = await axios.get(url, { timeout: LIVE_VERSION_TIMEOUT_MS });
    const data = (resp?.data ?? {}) as Record<string, unknown>;
    const pick = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() !== '' && v !== 'unknown' ? v : null;
    return {
      sha: pick(data.sha),
      version: pick(data.version),
      build_time: pick(data.buildTime),
    };
  } catch {
    return { sha: null, version: null, build_time: null };
  }
}

async function fetchCommitDate(sha: string): Promise<string | null> {
  const result = await githubGet<GhCommit>(`https://api.github.com/repos/${githubRepo()}/commits/${sha}`, {});
  if (!result.ok) return null;
  return result.data?.commit?.author?.date ?? result.data?.commit?.committer?.date ?? null;
}

/**
 * 三条线共享的部署摘要：staging(:5201)/production(:5200) 各自真实 /version。
 * 只要有一边真拿到过数据就缓存（本地/CI 环境两边都拿不到很正常，不缓存好让下次重试）。
 */
async function fetchDeploymentSummary(): Promise<DeploymentSummaryInternal> {
  if (deploymentSummaryCache && Date.now() < deploymentSummaryCache.expiresAt) {
    return deploymentSummaryCache.value;
  }

  const [staging, production] = await Promise.all([
    fetchLiveVersion(STAGING_VERSION_URL),
    fetchLiveVersion(PROD_VERSION_URL),
  ]);
  const productionCommitDate = production.sha ? await fetchCommitDate(production.sha) : null;

  const value: DeploymentSummaryInternal = {
    summary: { staging, production },
    productionCommitDate,
  };
  if (staging.sha || production.sha) {
    deploymentSummaryCache = { value, expiresAt: Date.now() + DEPLOYMENT_SUMMARY_TTL_MS };
  }
  return value;
}

async function fetchRecentCommitOnMain(
  relatedPath: string
): Promise<{ commit: LineRecentCommit | null; sawHttp200: boolean }> {
  const result = await githubGet<GhCommit[]>(`https://api.github.com/repos/${githubRepo()}/commits`, {
    sha: 'main',
    path: relatedPath,
    per_page: 1,
  });
  if (!result.ok) return { commit: null, sawHttp200: false };

  const commits = Array.isArray(result.data) ? result.data : [];
  const top = commits[0];
  if (!top?.sha) return { commit: null, sawHttp200: result.status === 200 };

  return {
    commit: {
      sha: top.sha,
      message: top.commit?.message ?? '',
      date: top.commit?.author?.date ?? top.commit?.committer?.date ?? null,
      url: top.html_url ?? `https://github.com/${githubRepo()}/commit/${top.sha}`,
    },
    sawHttp200: true,
  };
}

async function fetchRelatedPrs(
  keywords: string[]
): Promise<{ prs: LineRelatedPr[]; sawHttp200: boolean }> {
  const query = `repo:${githubRepo()} is:pr in:title ${keywords.join(' OR ')}`;
  const result = await githubGet<{ items?: GhSearchItem[] }>('https://api.github.com/search/issues', {
    q: query,
    sort: 'updated',
    order: 'desc',
    per_page: 5,
  });
  if (!result.ok) return { prs: [], sawHttp200: false };

  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  const prs = items
    .filter((item) => typeof item.number === 'number')
    .map((item) => ({
      number: item.number as number,
      title: item.title ?? '',
      url: item.html_url ?? '',
      state: item.state ?? 'unknown',
      updated_at: item.updated_at ?? null,
    }));
  return { prs, sawHttp200: result.status === 200 };
}

/**
 * main 分支上、production 真实提交时间之后、命中该线相关路径的提交列表——"待发布变更清单"。
 * sinceDate 为空（production /version 不可达，取不到真实提交时间）时直接返回空，不发起请求。
 * GitHub commits API 的 since 是按提交时间闭区间，返回结果里若含 production 自身那条提交
 * （sha 相同）需要过滤掉，只保留严格更新的部分。
 */
async function fetchPendingChanges(
  relatedPath: string,
  sinceDate: string | null,
  excludeSha: string | null
): Promise<{ changes: LinePendingChange[]; sawHttp200: boolean }> {
  if (!sinceDate) return { changes: [], sawHttp200: false };
  const result = await githubGet<GhCommit[]>(`https://api.github.com/repos/${githubRepo()}/commits`, {
    sha: 'main',
    path: relatedPath,
    since: sinceDate,
    per_page: 15,
  });
  if (!result.ok) return { changes: [], sawHttp200: false };

  const commits = Array.isArray(result.data) ? result.data : [];
  const changes = commits
    .filter((c) => typeof c.sha === 'string' && c.sha !== excludeSha)
    .map((c) => ({
      sha: c.sha as string,
      message: (c.commit?.message ?? '').split('\n')[0],
      url: c.html_url ?? `https://github.com/${githubRepo()}/commit/${c.sha}`,
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null,
    }));
  return { changes, sawHttp200: result.status === 200 };
}

async function fetchLinePendingChanges(
  def: LineDef,
  productionSha: string | null,
  productionCommitDate: string | null
): Promise<LinePendingChange[]> {
  const cached = readPendingChanges(def.lineKey);
  if (cached) return cached;

  const relatedPath = def.relatedPaths[0] ?? '';
  const { changes, sawHttp200 } = await fetchPendingChanges(relatedPath, productionCommitDate, productionSha);
  if (sawHttp200) writePendingChanges(def.lineKey, changes);
  return changes;
}

// ─── 三个端点的聚合构造 ──────────────────────────────────────────────────────

const EMPTY_LIVE_VERSION: LiveVersion = { sha: null, version: null, build_time: null };

function notConnectedDeployment(lineKey: string): LineDeployment {
  return {
    line_key: lineKey,
    connected: false,
    message: NOT_CONNECTED_MESSAGE,
    staging: EMPTY_LIVE_VERSION,
    production: EMPTY_LIVE_VERSION,
    recent_commit: null,
    related_prs: [],
  };
}

export async function buildLineDeployment(def: LineDef): Promise<LineDeployment> {
  const cached = readSlot(deploymentCache, def.lineKey);
  if (cached.hit) return cached.value;

  if (!def.journeyId) {
    const payload = notConnectedDeployment(def.lineKey);
    deploymentCache = makeSlot(def.lineKey, payload);
    return payload;
  }

  const relatedPath = def.relatedPaths[0] ?? '';
  // 部署摘要 / 最近相关提交 / 关联 PR 彼此独立（判定点 4：一处限流不得拖垮整块）
  const [{ summary }, { commit: recentCommit, sawHttp200: recentOk }, { prs, sawHttp200: prsOk }] =
    await Promise.all([
      fetchDeploymentSummary(),
      fetchRecentCommitOnMain(relatedPath),
      fetchRelatedPrs(def.prTitleKeywords),
    ]);

  const payload: LineDeployment = {
    line_key: def.lineKey,
    connected: true,
    message: null,
    staging: summary.staging,
    production: summary.production,
    recent_commit: recentCommit,
    related_prs: prs,
  };

  if (recentOk || prsOk || summary.staging.sha || summary.production.sha) {
    deploymentCache = makeSlot(def.lineKey, payload);
  }
  return payload;
}

export async function buildLineAbilities(def: LineDef): Promise<LineAbilities> {
  if (!def.journeyId) {
    return {
      line_key: def.lineKey,
      connected: false,
      message: NOT_CONNECTED_MESSAGE,
      abilities: [],
    };
  }

  try {
    const features = await fetchJourneyFeatures(def.journeyId);
    return {
      line_key: def.lineKey,
      connected: true,
      message: null,
      abilities: features.map(mapAbility),
    };
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'brain unavailable';
    return {
      line_key: def.lineKey,
      connected: true,
      message: `Brain: ${message}`,
      abilities: [],
    };
  }
}

function mapAbility(feature: JourneyFeature): LineAbility {
  return {
    id: feature.id,
    name: feature.name,
    status: feature.status ?? 'unknown',
    thickness: feature.thickness ?? 'unknown',
    kind: feature.kind ?? 'feature',
    updated_at: feature.updated_at ?? null,
  };
}

function notConnectedItem(def: LineDef, label: string): LineHealthItem {
  return {
    line_key: def.lineKey,
    label,
    journey_id: null,
    journey_name: null,
    // 判定点 1：字面区分"未接入"与"0 进度"——前端靠 availability/maturity 判断，不靠 0/0 反推
    maturity: 'not_connected',
    availability: 'not_connected',
    message: null,
    feature_counts: { total: 0, done: 0, working: 0, planned: 0 },
    pending_changes: [],
  };
}

async function buildConnectedItem(
  def: LineDef,
  label: string,
  productionSha: string | null,
  productionCommitDate: string | null
): Promise<LineHealthItem> {
  let features: JourneyFeature[] = [];
  const messages: string[] = [];

  try {
    features = await fetchJourneyFeatures(def.journeyId as string);
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'brain unavailable';
    messages.push(`Brain: ${message}`);
  }

  // 待发布变更清单走独立的 GitHub 抓取，永不抛异常（各自独立降级），
  // 不把"抓不到"当成 degraded 的理由——只有 Brain 真故障才算 degraded。
  const pending_changes = await fetchLinePendingChanges(def, productionSha, productionCommitDate);

  const doneCount = features.filter((feature) => feature.status === 'done').length;

  return {
    line_key: def.lineKey,
    label,
    journey_id: def.journeyId,
    journey_name: def.journeyName,
    maturity: maturityFromCounts(doneCount, features.length),
    availability: messages.length > 0 ? 'degraded' : 'ready',
    message: messages.length > 0 ? messages.join('; ') : null,
    feature_counts: {
      total: features.length,
      done: doneCount,
      working: features.filter((feature) => feature.status === 'working').length,
      planned: features.filter((feature) => feature.status === 'planned').length,
    },
    pending_changes,
  };
}

export async function buildLineHealthOverview(): Promise<LineHealthOverview> {
  const { lines, error } = loadCustomerLines();
  // product-map 读取失败 → 用代码内置 LINE_DEFS 兜底（HTTP 仍 200，前端顶部 banner 提示）
  const labelOf = (def: LineDef): string =>
    lines?.find((line) => line.id === def.lineKey)?.name ?? def.label;

  const { summary, productionCommitDate } = await fetchDeploymentSummary();

  const data = await Promise.all(
    LINE_DEFS.map((def) =>
      def.journeyId
        ? buildConnectedItem(def, labelOf(def), summary.production.sha, productionCommitDate)
        : Promise.resolve(notConnectedItem(def, labelOf(def)))
    )
  );

  return {
    data,
    deployment: summary,
    source: lines ? 'product_map' : 'fallback',
    fallback_reason: lines ? null : error,
  };
}
