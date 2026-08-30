/**
 * 工作机控制塔 API 客户端（决策 e14297d4）。契约见 docs/superpowers/specs/2026-08-30-worker-control-tower-design.md
 *
 * 鉴权与 machines.api 同款：license Bearer（若有） + cookie。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function getLicenseToken(): string {
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(^|; )license=([^;]+)/);
    if (m) return decodeURIComponent(m[2]);
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('zj_license') || '';
  }
  return '';
}

function authHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  const lic = getLicenseToken();
  if (lic) headers.set('Authorization', `Bearer ${lic}`);
  return headers;
}

export interface WorkerRunning {
  task_id: string;
  title: string;
  current_step: number;
  steps_total: number;
}

export interface Worker {
  id: string;
  agent_id: string;
  hostname: string;
  nickname: string | null;
  os_type: 'android' | 'win32' | string | null;
  status: 'online' | 'offline';
  running: WorkerRunning | null;
  completed_today: number;
  last_seen: string | null;
}

export interface WorkerStep {
  step_index: number;
  title: string;
  status: 'pending' | 'doing' | 'done' | 'failed';
  screenshot_url: string | null;
  foreground_pkg?: string | null;
  diag_line?: string | null;
  note?: string | null;
  updated_at?: string;
}

export interface WorkerTaskSummary {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'needs_review';
  steps_total: number;
  started_at: string;
  finished_at: string | null;
  failed_step: number | null;
  error_code: string | null;
}

export interface WorkerActivity {
  current: (WorkerTaskSummary & { current_step: number }) | null;
  steps: WorkerStep[];
  history: WorkerTaskSummary[];
  /**
   * 距最新一帧推送的毫秒数，由后端算好下发；从未推过帧时为 null。
   * Chrome 对 multipart/x-mixed-replace 的 <img> 只在首帧触发一次 load，前端不能靠 onLoad 计时判断画面卡住，
   * 也不能自己拿服务端 at 时间戳跟浏览器 Date.now() 比（两端时钟可能有偏差）。
   */
  frame_age_ms: number | null;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders(), credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).data as T;
}

export const fetchWorkers = () => getJson<Worker[]>(`${API_BASE}/workers`);

export const fetchWorkerActivity = (agentId: string) =>
  getJson<WorkerActivity>(`${API_BASE}/workers/${encodeURIComponent(agentId)}/activity`);

export const workerLiveUrl = (agentId: string) => `${API_BASE}/workers/${encodeURIComponent(agentId)}/live`;
