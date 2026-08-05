/**
 * 员工工作台（Workbench）服务 — Staff Hub 直连 Brain（决策 fc7b5dc0 同款代理模式）
 *
 * Task: 9cc10ff2 · 军师台落地序列第 8 件（决策 af0d0818 执行层）
 * 数据源：
 *   - 待处理门槛：Brain /api/brain/acceptance/pending（复用 acceptance service）
 *   - AI 后台任务：Brain /api/brain/tasks?status=in_progress
 *   - 近7天完成：Brain /api/brain/tasks?status=completed（客户端按 completed_at 过滤）
 *   - 反馈网关：Brain POST /api/brain/captures（source='api'，吃 capture 去向链）
 * 纪律：Brain 不可达 → availability='degraded' 诚实降级，绝不 500。
 */
import axios from 'axios';
import { fetchPendingRuns, type AcceptanceRun } from './acceptance';

const CECELIA_BRAIN_BASE = (): string =>
  process.env.CECELIA_BRAIN_URL ?? 'http://host.docker.internal:5221';

const BRAIN_TIMEOUT_MS = 8000;

export type WorkbenchAiTask = {
  id: string;
  title: string;
  task_type: string;
  updated_at?: string | null;
};

export type WorkbenchPendingRun = {
  run_key: string;
  gp_title: string | null;
  checks_total: number;
};

export type WorkbenchSummary = {
  availability: 'ready' | 'degraded';
  metrics: { pending_acceptance: number; ai_running: number; completed_7d: number };
  pending_runs: WorkbenchPendingRun[];
  ai_tasks: WorkbenchAiTask[];
  message: string | null;
};

type BrainTaskRow = {
  id: string;
  title?: string;
  task_type?: string;
  status?: string;
  updated_at?: string;
  completed_at?: string | null;
};

async function fetchBrainTasks(status: string, limit: number): Promise<BrainTaskRow[]> {
  const url = `${CECELIA_BRAIN_BASE()}/api/brain/tasks?status=${encodeURIComponent(status)}&limit=${limit}`;
  const resp = await axios.get(url, { timeout: BRAIN_TIMEOUT_MS });
  const data = resp.data;
  if (Array.isArray(data)) return data as BrainTaskRow[];
  if (Array.isArray(data?.tasks)) return data.tasks as BrainTaskRow[];
  return [];
}

export async function fetchWorkbenchSummary(): Promise<WorkbenchSummary> {
  const [pendingSettled, inProgressSettled, completedSettled] = await Promise.allSettled([
    fetchPendingRuns(),
    fetchBrainTasks('in_progress', 20),
    fetchBrainTasks('completed', 100),
  ]);

  const messages: string[] = [];

  let pendingRuns: WorkbenchPendingRun[] = [];
  let pendingCount = 0;
  if (pendingSettled.status === 'fulfilled') {
    const runs: AcceptanceRun[] = pendingSettled.value.runs ?? [];
    pendingRuns = runs.map((r) => ({
      run_key: r.run_key,
      gp_title: (r as { gp_title?: string | null }).gp_title ?? null,
      checks_total: Array.isArray(r.checks) ? r.checks.length : 0,
    }));
    pendingCount = pendingRuns.length;
    if (pendingSettled.value.availability === 'degraded' && pendingSettled.value.message) {
      messages.push(pendingSettled.value.message);
    }
  } else {
    messages.push(`acceptance: ${(pendingSettled.reason as Error)?.message ?? 'unavailable'}`);
  }

  let aiTasks: WorkbenchAiTask[] = [];
  if (inProgressSettled.status === 'fulfilled') {
    aiTasks = inProgressSettled.value.map((t) => ({
      id: t.id,
      title: t.title ?? '(untitled)',
      task_type: t.task_type ?? 'unknown',
      updated_at: t.updated_at ?? null,
    }));
  } else {
    messages.push(`Brain: ${(inProgressSettled.reason as Error)?.message ?? 'unavailable'}`);
  }

  let completed7d = 0;
  if (completedSettled.status === 'fulfilled') {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    completed7d = completedSettled.value.filter((t) => {
      const ts = t.completed_at ? Date.parse(t.completed_at) : NaN;
      return !Number.isNaN(ts) && ts >= weekAgo;
    }).length;
  }
  // completed 拉取失败不单独报错（指标非关键），degraded 语义由上两路决定

  const degraded =
    pendingSettled.status === 'rejected' || inProgressSettled.status === 'rejected' ||
    (pendingSettled.status === 'fulfilled' && pendingSettled.value.availability === 'degraded');

  return {
    availability: degraded ? 'degraded' : 'ready',
    metrics: { pending_acceptance: pendingCount, ai_running: aiTasks.length, completed_7d: completed7d },
    pending_runs: pendingRuns,
    ai_tasks: aiTasks,
    message: messages.length > 0 ? messages.join(' | ') : null,
  };
}

export type WorkbenchFeedbackInput = {
  content: string;
  nature?: 'issue';
  link?: string;
  email?: string;
};

export type WorkbenchFeedbackReceipt = {
  id: string;
  status: string;
  dedupe_hit: boolean;
};

export async function submitWorkbenchFeedback(input: WorkbenchFeedbackInput): Promise<WorkbenchFeedbackReceipt> {
  const payload: Record<string, unknown> = {
    content: input.email ? `[staff:${input.email}] ${input.content}` : input.content,
    source: 'api',
  };
  if (input.nature === 'issue') payload.nature = 'issue';
  if (input.link) payload.ref_pr_url = input.link;

  const resp = await axios.post(`${CECELIA_BRAIN_BASE()}/api/brain/captures`, payload, {
    timeout: BRAIN_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
  const data = resp.data ?? {};
  return {
    id: String(data.id ?? ''),
    status: String(data.status ?? 'captured'),
    dedupe_hit: Boolean(data.dedupe_hit),
  };
}
