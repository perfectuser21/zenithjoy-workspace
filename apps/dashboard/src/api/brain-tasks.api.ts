/**
 * Brain task database 读取客户端
 *
 * 0923 主理人定的范围：生产前端只负责把 task database 里的任务**显示**出来。
 * 留痕（谁跑的/跑多久/烧了多少 token）不在这一层，也不做 UI。
 *
 * 通路：nginx 已有 `/api/brain/` → 100.71.151.105:5221 的代理。
 * 生产实测 `curl https://autopilot.zenjoymedia.media/api/brain/tasks` → HTTP 200。
 *
 * ⚠️ 接口有个反直觉的地方（实测）：**不带任何过滤参数时只返回 10 个精简字段**
 * （id/title/description/priority/status/project_id/queued_at/updated_at/due_at/custom_props），
 * 带上 `status=` 或 `task_type=` 才返回完整 70+ 字段（含 task_type/tenant_id/
 * trigger_source/claimed_by/error_message…）。
 * 所以这里**总是带 status**——没有类型和客户的任务列表，看不出哪条是派给手机的活、算谁的。
 */

export type BrainTaskStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'canceled'
  | 'archived';

export interface BrainTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  /** 只在带过滤参数时返回 —— 见文件头注释 */
  task_type?: string | null;
  tenant_id?: string | null;
  dept?: string | null;
  trigger_source?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  retry_count?: number | null;
  execution_attempts?: number | null;
  error_message?: string | null;
  queued_at?: string | null;
  due_at?: string | null;
  updated_at?: string | null;
}

/** 一次拉多个状态：接口一次只认一个 status，这里并发取完再合并 */
export async function fetchBrainTasks(
  statuses: string[],
  opts: { limit?: number; taskType?: string } = {}
): Promise<BrainTask[]> {
  const limit = opts.limit ?? 100;
  const results = await Promise.all(
    statuses.map(async (status) => {
      const qs = new URLSearchParams({ status, limit: String(limit) });
      if (opts.taskType) qs.set('task_type', opts.taskType);
      const r = await fetch(`/api/brain/tasks?${qs.toString()}`);
      if (!r.ok) {
        // 往上抛，页面据此显示「读取失败」。
        // 绝不 catch 成空数组——空表和读不到长得一模一样，人会以为「今天没排活」，
        // 而实际是后台断了。
        throw new Error(`BRAIN_HTTP_${r.status}`);
      }
      const d = await r.json();
      return (Array.isArray(d) ? d : d?.tasks || d?.data || []) as BrainTask[];
    })
  );
  const merged = results.flat();
  // 同一条任务不会跨状态重复，但接口层面不保证，去一次重更稳
  const seen = new Set<string>();
  return merged.filter((t) => (t?.id && !seen.has(t.id) ? (seen.add(t.id), true) : false));
}
