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
 * 判定点（详见 contract-draft.md 判定点登记表）：
 *   1. line01/line02 未接入 Brain → 专门 "not_connected" 态（字面区分，不靠 0/0 反推）
 *   2. Brain 故障（仅 line04 会发起该请求）→ "degraded" + "Brain:" 前缀消息，HTTP 仍 200
 *   3. "版本" = 按业务线相关路径过滤的最近 commit（不是全局 HEAD，也不查 /version 端点）
 *   4. "关联 PR" = GitHub Search Issues 按标题关键词匹配（接受稀疏结果）
 *   5. 降级粒度 = 按字段独立（三个环境彼此独立 try/catch，related_prs 与 abilities 再独立）
 *   6. GitHub 数据缓存 5 分钟（未认证 60 次/小时限额，多员工同开会打满）
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import {
  GitHubRun,
  JourneyFeature,
  fetchJourneyFeatures,
  fetchLatestSmokeRun,
  githubHeaders,
  githubRepo,
  maturityFromCounts,
} from './staff-health';

/** 判定点 2：未接入业务线的空态文案（前端直接渲染，不重新措辞） */
export const NOT_CONNECTED_MESSAGE = '该业务线尚未接入 Brain 数据，暂无法展示';

/**
 * 环境"陈旧"阈值：分支存在且找到匹配提交，但提交时间距今超过该天数 → status=stale。
 * 仓库当前 develop（末次提交 2026-03-07）/ release/cs-stable（2026-06-23）都已严重陈旧，
 * 没有这条阈值它们会被显示成 active，比"没有环境"更具误导性（Reviewer r1 必须修复项1）。
 * thin 阶段硬编码，不做环境变量化（已在合同保质期条款登记为可调技术债）。
 */
export const STALE_THRESHOLD_DAYS = 30;

/** 判定点 6：GitHub 数据缓存 TTL */
const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000;

export type LineKey = 'line01' | 'line02' | 'line04';
export type EnvName = 'dev' | 'staging' | 'production';
export type EnvStatus = 'active' | 'stale' | 'not_deployed' | 'unavailable';

export type LineDef = {
  lineKey: LineKey;
  label: string;
  /** null = 尚未接入 Brain（line01/line02），压根不发起 Brain 请求 */
  journeyId: string | null;
  journeyName: string | null;
  smokeWorkflowHints: string[];
  /** 按路径过滤最近 commit 用；thin 阶段每个环境只打一次 GitHub，取首个代表路径 */
  relatedPaths: string[];
  prTitleKeywords: string[];
};

export const LINE_DEFS: LineDef[] = [
  {
    lineKey: 'line01',
    label: 'Line 01 客户首次成功',
    journeyId: null,
    journeyName: null,
    smokeWorkflowHints: ['golden-path-1', 'path1'],
    relatedPaths: ['apps/api/src/routes/publish.ts'],
    prTitleKeywords: ['line01', 'path1'],
  },
  {
    lineKey: 'line02',
    label: 'Line 02 客户智能获客',
    journeyId: null,
    journeyName: null,
    smokeWorkflowHints: ['golden-path-2', 'path2', 'acquisition'],
    relatedPaths: ['apps/api/src/routes/acquisition.ts'],
    prTitleKeywords: ['line02', 'acquisition'],
  },
  {
    lineKey: 'line04',
    label: 'Line 04 客户私域 AI 接管',
    // PR #1487 修复后的整合版"智能客服" journey，不得回退到已废弃孤儿 journey
    journeyId: 'e675da0f-1117-4301-a801-cd4753beb8c8',
    journeyName: '智能客服',
    smokeWorkflowHints: ['golden-path-4', 'path4', 'wechat'],
    relatedPaths: ['apps/api/src/routes/wechat.ts', 'apps/api/src/services/wechat'],
    prTitleKeywords: ['wechat'],
  },
];

/**
 * 环境 → 分支映射。用 commits API `?sha=<branch>&path=<related_path>` 单次调用同时判断
 * "分支是否存在"（404 = 不存在）与"该分支该路径最近提交"，不额外调 Deployments API
 * （本仓库未启用 GitHub Environments/Deployments，无历史记录可查）。
 * staging 对应 `release/*` 系列当前唯一在用的 release/cs-stable（新增 release 分支需同步，
 * 已在合同保质期条款登记）。
 */
const ENV_BRANCHES: Array<{ name: EnvName; branch: string }> = [
  { name: 'dev', branch: 'develop' },
  { name: 'staging', branch: 'release/cs-stable' },
  { name: 'production', branch: 'main' },
];

export type LineEnvironment = {
  name: EnvName;
  status: EnvStatus;
  commit_sha: string | null;
  commit_date: string | null;
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

export type LineDeployment = {
  line_key: string;
  connected: boolean;
  message: string | null;
  environments: LineEnvironment[];
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
  smoke: null | {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    started_at: string | null;
    updated_at: string | null;
  };
};

export type LineHealthOverview = {
  data: LineHealthItem[];
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

// ─── GitHub 抓取 + 缓存（判定点 6）──────────────────────────────────────────

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
/** 总览页 smoke run 单槽缓存（URL 恒定，只随 hints 变） */
let smokeCache: SingleSlotCache<GitHubRun | null> = null;

/** 仅供测试/运维排障使用：清空 line-health 的全部 GitHub 缓存 */
export function clearLineHealthCache(): void {
  deploymentCache = null;
  smokeCache = null;
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

function isStale(commitDate: string | null): boolean {
  if (!commitDate) return false;
  const ts = Date.parse(commitDate);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
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

async function fetchEnvironment(
  env: { name: EnvName; branch: string },
  relatedPath: string
): Promise<{ environment: LineEnvironment; commit: GhCommit | null; sawHttp200: boolean }> {
  const result = await githubGet<GhCommit[]>(`https://api.github.com/repos/${githubRepo()}/commits`, {
    sha: env.branch,
    path: relatedPath,
    per_page: 1,
  });

  if (!result.ok) {
    // 网络/限流/分支 404 —— 与"分支存在但查无提交"必须区分（NFR 可观测条款）
    return {
      environment: { name: env.name, status: 'unavailable', commit_sha: null, commit_date: null },
      commit: null,
      sawHttp200: false,
    };
  }

  const sawHttp200 = result.status === 200;
  const commits = Array.isArray(result.data) ? result.data : [];
  const top = commits[0];
  if (!top?.sha) {
    return {
      environment: { name: env.name, status: 'not_deployed', commit_sha: null, commit_date: null },
      commit: null,
      sawHttp200,
    };
  }

  const commitDate = top.commit?.author?.date ?? top.commit?.committer?.date ?? null;
  return {
    environment: {
      name: env.name,
      status: isStale(commitDate) ? 'stale' : 'active',
      commit_sha: top.sha,
      commit_date: commitDate,
    },
    commit: top,
    sawHttp200,
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

// ─── 三个端点的聚合构造 ──────────────────────────────────────────────────────

function notConnectedDeployment(lineKey: string): LineDeployment {
  return {
    line_key: lineKey,
    connected: false,
    message: NOT_CONNECTED_MESSAGE,
    environments: [],
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
  // 三个环境彼此独立（判定点 5：一处限流不得拖垮整块）
  const envResults = await Promise.all(
    ENV_BRANCHES.map((env) => fetchEnvironment(env, relatedPath))
  );
  const { prs, sawHttp200: prsOk } = await fetchRelatedPrs(def.prTitleKeywords);

  const environments = envResults.map((r) => r.environment);
  const productionResult = envResults.find((r) => r.environment.name === 'production');
  const productionCommit = productionResult?.commit ?? null;

  // recent_commit 直接复用 production 环境已取到的 commit，不重复调用 GitHub（合同要求二者一致）
  const recentCommit: LineRecentCommit | null = productionCommit?.sha
    ? {
        sha: productionCommit.sha,
        message: productionCommit.commit?.message ?? '',
        date: productionResult?.environment.commit_date ?? null,
        url:
          productionCommit.html_url ??
          `https://github.com/${githubRepo()}/commit/${productionCommit.sha}`,
      }
    : null;

  const payload: LineDeployment = {
    line_key: def.lineKey,
    connected: true,
    message: null,
    environments,
    recent_commit: recentCommit,
    related_prs: prs,
  };

  if (envResults.some((r) => r.sawHttp200) || prsOk) {
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

async function fetchSmokeRunCached(hints: string[]): Promise<GitHubRun | null> {
  const key = hints.join('|');
  const cached = readSlot(smokeCache, key);
  if (cached.hit) return cached.value;
  const run = await fetchLatestSmokeRun(hints);
  smokeCache = makeSlot(key, run);
  return run;
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
    smoke: null,
  };
}

async function buildConnectedItem(def: LineDef, label: string): Promise<LineHealthItem> {
  let features: JourneyFeature[] = [];
  let smoke: GitHubRun | null = null;
  const messages: string[] = [];

  try {
    features = await fetchJourneyFeatures(def.journeyId as string);
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'brain unavailable';
    messages.push(`Brain: ${message}`);
  }

  try {
    smoke = await fetchSmokeRunCached(def.smokeWorkflowHints);
    if (!smoke) messages.push('GitHub: no recent smoke run matched');
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'github unavailable';
    messages.push(`GitHub: ${message}`);
  }

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
    smoke: smoke
      ? {
          id: smoke.id,
          name: smoke.name,
          status: smoke.status,
          conclusion: smoke.conclusion,
          html_url: smoke.html_url,
          started_at: smoke.run_started_at ?? null,
          updated_at: smoke.updated_at ?? null,
        }
      : null,
  };
}

export async function buildLineHealthOverview(): Promise<LineHealthOverview> {
  const { lines, error } = loadCustomerLines();
  // product-map 读取失败 → 用代码内置 LINE_DEFS 兜底（HTTP 仍 200，前端顶部 banner 提示）
  const labelOf = (def: LineDef): string =>
    lines?.find((line) => line.id === def.lineKey)?.name ?? def.label;

  const data = await Promise.all(
    LINE_DEFS.map((def) => (def.journeyId ? buildConnectedItem(def, labelOf(def)) : Promise.resolve(notConnectedItem(def, labelOf(def)))))
  );

  return {
    data,
    source: lines ? 'product_map' : 'fallback',
    fallback_reason: lines ? null : error,
  };
}
