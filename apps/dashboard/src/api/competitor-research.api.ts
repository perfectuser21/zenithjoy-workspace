/**
 * 智能对标账号采集 API 客户端
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5200') as string;

// ============ 类型定义 ============

export interface AccountRecord {
  round: number;
  keyword: string;
  creatorName: string;
  douyinId: string;
  profileUrl: string;
  bio: string;
  followers: number;
  following: number;
  workCount: number;
  videoUrl1: string;
  videoUrl2: string;
}

export interface StartResearchParams {
  topic: string;
  roundLimit: number;
}

export interface StartResearchResult {
  jobId: string;
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobStatusResult {
  status: JobStatus;
  logs: string[];
  progress?: number;
  error?: string;
}

export interface JobResultsData {
  primaryScreening: AccountRecord[];
  secondaryScreening: AccountRecord[];
  finalPool: AccountRecord[];
  report: {
    topic: string;
    executedAt: string;
    roundLimit: number;
    primaryCount: number;
    secondaryCount: number;
    finalCount: number;
    [key: string]: unknown;
  };
}

// ============ API 函数 ============

/**
 * 启动对标账号采集任务
 */
export async function startCompetitorResearch(
  params: StartResearchParams
): Promise<StartResearchResult> {
  const resp = await fetch(`${API_BASE}/api/competitor-research/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`启动失败 (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<StartResearchResult>;
}

/**
 * 查询任务状态
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResult> {
  const resp = await fetch(`${API_BASE}/api/competitor-research/status/${jobId}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`查询状态失败 (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<JobStatusResult>;
}

/**
 * 获取任务结果
 */
export async function getJobResults(jobId: string): Promise<JobResultsData> {
  const resp = await fetch(`${API_BASE}/api/competitor-research/results/${jobId}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`获取结果失败 (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<JobResultsData>;
}
