/**
 * Staff Hub 健康类看板共用数据源
 *
 * 从 routes/staff.ts 抽出，避免 line-health（业务线健康看板）重复实现同一套
 * Brain journey_features / GitHub Actions runs 拉取逻辑（DRY），也让 staff.ts
 * 不因新增端点而膨胀到 500 行以上。原「Path 健康」页面（/path-health）曾是本模块
 * 另一个消费者，已下线合并进业务线健康看板（line-health.ts）。
 *
 * 注意：本模块**不做任何缓存**——line-health 现有合同测试按 axios 调用顺序断言降级行为，
 * 在这里加缓存会改变其调用次数。缓存策略是 line-health 自己的事（见 line-health.ts）。
 */
import axios from 'axios';

export type JourneyFeature = {
  id: string;
  name: string;
  status?: string | null;
  thickness?: string | null;
  kind?: string | null;
  updated_at?: string | null;
};

export type GitHubRun = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  name: string;
  display_title?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
};

export const CECELIA_BRAIN_BASE = (): string =>
  process.env.CECELIA_BRAIN_URL ?? 'http://host.docker.internal:5221';

export const githubRepo = (): string =>
  process.env.STAFF_HUB_GITHUB_REPO ?? 'perfectuser21/zenithjoy-workspace';

export function githubHeaders(): Record<string, string> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'zenithjoy-staff-hub',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function maturityFromCounts(done: number, total: number): 'thin' | 'medium' | 'thick' | 'mature' {
  if (total <= 0 || done <= 0) return 'thin';
  const ratio = done / total;
  if (ratio >= 1) return 'mature';
  if (ratio >= 0.66) return 'thick';
  if (ratio >= 0.33) return 'medium';
  return 'thin';
}

export async function fetchJourneyFeatures(journeyId: string): Promise<JourneyFeature[]> {
  const upstream = await axios.get(`${CECELIA_BRAIN_BASE()}/api/brain/journey_features`, {
    params: { journey_id: journeyId },
    timeout: 20000,
  });
  return Array.isArray(upstream.data) ? (upstream.data as JourneyFeature[]) : [];
}

export async function fetchLatestSmokeRun(hints: string[]): Promise<GitHubRun | null> {
  const upstream = await axios.get(`https://api.github.com/repos/${githubRepo()}/actions/runs`, {
    headers: githubHeaders(),
    params: { per_page: 30 },
    timeout: 20000,
  });
  const runs = Array.isArray(upstream.data?.workflow_runs)
    ? (upstream.data.workflow_runs as GitHubRun[])
    : [];
  const matched = runs.find((run) => {
    const hay = `${run.name} ${run.display_title ?? ''}`.toLowerCase();
    return hints.some((hint) => hay.includes(hint.toLowerCase()));
  });
  return matched ?? null;
}
