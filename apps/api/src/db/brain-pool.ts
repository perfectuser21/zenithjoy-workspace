/**
 * Brain 库连接池（只读排程 + 写 device_job 任务单）
 *
 * 排程的真身是 us-vps Brain 的 `public.tasks`（决策 e1ec93b2：Brain tasks = 唯一真身）。
 * 中台不另建排程表 —— 建了就是账实分叉。所以这里开一个**独立于本地库**的池指向 Brain。
 *
 * 为什么直连库而不是调 Brain HTTP API：
 *  - 改计划时间必须是 CAS（`UPDATE ... WHERE row_version = $n`，invariant 761f242b），
 *    Brain 的 PATCH /tasks 没有这个语义，且它的字段白名单里没有 due_at/dept/assigned_to。
 *  - 写进去的仍是真身那张表，不产生第二份账。
 *
 * 连接走 tailscale 内网（hk-vps → 100.79.41.61:5432，实测通）。跨境 3 秒不够
 * （PR#1892 的丢单教训），连接超时给 8 秒。
 *
 * **没配置时不崩、也不装傻**：未配 BRAIN_DATABASE_HOST 时 `getBrainPool()` 返回 null，
 * 读面据此把 payload 标成 stale（页面显示"读取失败"），写面返回 503 并说明缺什么。
 * 本地开发与 CI 不配也能跑起来，但绝不会把"没连上"渲染成"今天没活"。
 */
import { Pool } from 'pg';

let pool: Pool | null = null;
let initialized = false;

export const BRAIN_CONNECT_TIMEOUT_MS = 8_000;

/** 返回 Brain 库连接池；未配置连接信息时返回 null（调用方必须显式处理）。 */
export function getBrainPool(): Pool | null {
  if (initialized) return pool;
  initialized = true;

  const host = process.env.BRAIN_DATABASE_HOST;
  if (!host) {
    console.warn('[brain-pool] 未配置 BRAIN_DATABASE_HOST —— 排程读面将返回 stale，写面将返回 503');
    return null;
  }

  pool = new Pool({
    host,
    port: parseInt(process.env.BRAIN_DATABASE_PORT || '5432', 10),
    database: process.env.BRAIN_DATABASE_NAME || 'cecelia',
    user: process.env.BRAIN_DATABASE_USER || 'cecelia',
    password: process.env.BRAIN_DATABASE_PASSWORD,
    max: 5,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: BRAIN_CONNECT_TIMEOUT_MS,
    // Brain 的 tasks 在 public；显式钉住，避免被本地库的 search_path 习惯带偏
    // （2026-07-13 P0 事故正是 zenithjoy.tasks 抢先解析了 Brain 的 public.tasks）。
    options: '-c search_path=public',
  });

  pool.on('error', (err) => {
    console.error('[brain-pool] 连接错误:', err.message);
  });

  return pool;
}

/** 测试用：重置单例，让不同用例能注入不同 env。 */
export function __resetBrainPoolForTest(): void {
  pool = null;
  initialized = false;
}
