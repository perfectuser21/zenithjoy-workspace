/**
 * Staff Hub 验收模块 — Brain 内网 acceptance 端点反代层
 *
 * 读路径（pending/history）：Brain 不可达时降级 availability='degraded'，不抛异常，
 * 参照 line-health.ts 的三态降级模型（此处永远是 ready/degraded 二态，无 not_connected）。
 * 写路径（submitResults）：Brain 报错必须让异常冒泡给调用方，不能伪装成功——
 * 员工提交结果这个动作有实际后果（触发驳回任务/算 pass_rate），绝不能静默丢失。
 */
import axios from 'axios';

const CECELIA_BRAIN_BASE = (): string =>
  process.env.CECELIA_BRAIN_URL ?? 'http://host.docker.internal:5221';

const TIMEOUT_MS = 20000;

export type AcceptanceCheck = {
  id: string;
  check_key: string;
  kind: 'FR' | 'NFR' | 'Invariant' | 'SOP';
  name: string;
  device: string | null;
  result: '通过' | '不通过' | '无法验证' | null;
  note: string | null;
  detail: { op?: string[]; exp?: string; pass?: string; fail?: string } | null;
  submitted_by: string | null;
  decided_at: string | null;
};

export type AcceptanceRun = {
  id: string;
  run_key: string;
  title: string;
  gp_id: string | null;
  line: string | null;
  surface: string | null;
  version: string | null;
  status: 'pending' | 'in_review' | 'passed' | 'failed';
  pass_rate: number | null;
  created_at: string;
  checks: AcceptanceCheck[];
};

export type AcceptanceListResult = {
  availability: 'ready' | 'degraded';
  runs: AcceptanceRun[];
  message: string | null;
};

async function fetchRunsList(url: string): Promise<AcceptanceListResult> {
  try {
    const upstream = await axios.get(url, { timeout: TIMEOUT_MS });
    const runs = Array.isArray(upstream.data?.runs) ? (upstream.data.runs as AcceptanceRun[]) : [];
    return { availability: 'ready', runs, message: null };
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'brain unavailable';
    return { availability: 'degraded', runs: [], message: `Brain: ${message}` };
  }
}

export async function fetchPendingRuns(): Promise<AcceptanceListResult> {
  return fetchRunsList(`${CECELIA_BRAIN_BASE()}/api/brain/acceptance/pending`);
}

export async function fetchHistoryByGpId(gpId: string): Promise<AcceptanceListResult> {
  const url = `${CECELIA_BRAIN_BASE()}/api/brain/acceptance/runs?gp_id=${encodeURIComponent(gpId)}`;
  return fetchRunsList(url);
}

export type SubmitResultItem = { check_key: string; result: '通过' | '不通过' | '无法验证'; note?: string };

export type SubmitResultsResponse = {
  updated: number;
  runs: Array<{ run_key: string; pass_rate: number; status: string }>;
};

export async function submitResults(
  items: SubmitResultItem[],
  submittedBy: string
): Promise<SubmitResultsResponse> {
  const payload = {
    results: items.map((item) => ({ ...item, submitted_by: submittedBy })),
  };
  // 写路径不 catch——失败必须冒泡给路由层返回非 200，不能伪装成功
  const upstream = await axios.post(`${CECELIA_BRAIN_BASE()}/api/brain/acceptance/results`, payload, {
    timeout: TIMEOUT_MS,
  });
  return upstream.data as SubmitResultsResponse;
}
