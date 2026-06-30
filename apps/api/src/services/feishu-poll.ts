/**
 * apps/api/src/services/feishu-poll.ts — Path 4 Sprint 1 ws5
 *
 * 中台飞书审批轮询：
 *   1) 30 秒一次 setInterval 拉飞书"内容排期" + "互动记录"表中状态变 'approved' 的草稿
 *   2) 校验 DB wechat_publish_task 对应 feishu_record_id 行（pending_review）
 *   3) UPDATE approval_source='feishu_user' approval_status='approved'（A 路线护栏 enforce）
 *   4) spawn rate_limiter.py can_send 校频控（chat / moment）
 *   5) 通过 → dispatchTask（type=wechat_send_chat / wechat_send_moment）
 *   6) 拒 → UPDATE approval_status='rate_limited' + next_allowed_at
 *
 * A 路线护栏 enforce:
 *   - approval_source 永远写 feishu_user（不写 system 或 auto；DB CHECK 约束 enforce）
 *   - DB CHECK 约束已 enforce 仅 ('feishu_user', 'feishu_api')
 *
 * Cron: 30s 一次（cron expression `[*]/30 * * * * *` 等价 setInterval(30_000)）
 *
 * 入口：
 *   pollOnce()                   — 单次轮询（手动 / 路由触发）
 *   startFeishuPoll(intervalMs)  — 启动周期轮询，返回 SchedulerHandle
 *   stopFeishuPoll(handle)       — clearInterval
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import axios from 'axios';
import pool from '../db/connection';
import { dispatchTask } from './task-dispatch';

// 30 秒一次（cron */30 * * * * * 或 setInterval(30 * 1000)）
const POLL_INTERVAL_MS = 30 * 1000;
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

const RATE_LIMITER_PY = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'services',
  'agent',
  'wechat-rpa',
  'rate_limiter.py',
);

export interface FeishuPollHandle {
  timer: NodeJS.Timeout;
}

interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface FeishuTokenResp {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuSearchResp {
  code: number;
  msg?: string;
  data?: { items?: FeishuRecord[]; has_more?: boolean };
}

let cachedToken: { value: string; expireAt: number } | null = null;

function _envFeishu() {
  return {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    appToken:
      process.env.FEISHU_TEST_APP_TOKEN ||
      process.env.FEISHU_PATH4_APP_TOKEN ||
      '',
    scheduleTableId: process.env.FEISHU_SCHEDULE_TABLE_ID || '',
    interactionTableId: process.env.FEISHU_INTERACTION_TABLE_ID || '',
  };
}

async function getFeishuToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expireAt > now + 60_000) {
    return cachedToken.value;
  }
  const env = _envFeishu();
  const resp = await axios.post<FeishuTokenResp>(
    `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
    { app_id: env.appId, app_secret: env.appSecret },
  );
  if (resp.data.code !== 0 || !resp.data.tenant_access_token) {
    throw new Error(
      `飞书获取 Token 失败: code=${resp.data.code} msg=${resp.data.msg ?? ''}`,
    );
  }
  cachedToken = {
    value: resp.data.tenant_access_token,
    expireAt: now + (resp.data.expire ?? 7000) * 1000,
  };
  return resp.data.tenant_access_token;
}

async function searchApprovedRecords(tableId: string): Promise<FeishuRecord[]> {
  if (!tableId) return [];
  let token: string;
  try {
    token = await getFeishuToken();
  } catch (err) {
    console.warn('[feishu-poll] 飞书 token 获取失败，跳过本轮:', err);
    return [];
  }

  const env = _envFeishu();
  const url = `${FEISHU_API_BASE}/bitable/v1/apps/${env.appToken}/tables/${tableId}/records/search`;
  try {
    const resp = await axios.post<FeishuSearchResp>(
      url,
      {
        page_size: 50,
        filter: {
          conjunction: 'and',
          conditions: [
            { field_name: '状态', operator: 'is', value: ['approved'] },
          ],
        },
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (resp.data.code !== 0) {
      console.warn(
        `[feishu-poll] search ${tableId} 失败: code=${resp.data.code} msg=${resp.data.msg ?? ''}`,
      );
      return [];
    }
    return resp.data.data?.items ?? [];
  } catch (err) {
    console.warn(`[feishu-poll] search ${tableId} 异常:`, err);
    return [];
  }
}

interface PollOnceResult {
  polled: number;
  dispatched: number;
}

interface RateLimitResult {
  ok: boolean;
  reason?: string;
  next_allowed_at?: string;
}

function checkRateLimit(action: 'chat' | 'moment', wechatId: string): RateLimitResult {
  // spawn rate_limiter.py can_send（多一层保险，中台已校但子进程也校防 race）
  try {
    const r = spawnSync(
      'python3',
      [
        RATE_LIMITER_PY,
        'can_send',
        `--action=${action}`,
        `--wechat_id=${wechatId}`,
      ],
      { encoding: 'utf-8', timeout: 5_000 },
    );
    if (r.status !== 0) {
      console.warn(
        `[feishu-poll] rate_limiter spawn 非 0：status=${r.status} stderr=${r.stderr}`,
      );
      // 调失败时按"放行"（fail-open；rate_limiter 自身坏掉时不连累中台）
      return { ok: true };
    }
    const stdout = (r.stdout || '').trim();
    const lastLine = stdout.split('\n').pop() || '{}';
    return JSON.parse(lastLine) as RateLimitResult;
  } catch (err) {
    console.warn('[feishu-poll] rate_limiter 调用异常:', err);
    return { ok: true };
  }
}

/**
 * 单次轮询 — 拉飞书 approved 草稿 → 写 DB approval_source=feishu_user → 派 task_dispatch。
 *
 * A 路线护栏：approval_source 永远写 'feishu_user'。
 */
export async function pollOnce(): Promise<PollOnceResult> {
  const env = _envFeishu();

  // 先取 token（避免 Promise.all 时双 token 请求 race）
  try {
    await getFeishuToken();
  } catch (err) {
    console.warn('[feishu-poll] 飞书 token 预取失败，跳过本轮:', err);
    return { polled: 0, dispatched: 0 };
  }

  // 拉飞书"内容排期"（朋友圈）+ "互动记录"（私聊）approved 草稿（顺序，简化 mock）
  const scheduleApproved = await searchApprovedRecords(env.scheduleTableId);
  const interactionApproved = await searchApprovedRecords(env.interactionTableId);

  let dispatched = 0;
  const allApproved: Array<{ record: FeishuRecord; type: 'moment' | 'chat' }> = [
    ...scheduleApproved.map((r) => ({ record: r, type: 'moment' as const })),
    ...interactionApproved.map((r) => ({ record: r, type: 'chat' as const })),
  ];

  for (const { record, type } of allApproved) {
    const recordId = record.record_id;
    if (!recordId) continue;

    // 1) DB SELECT 对应 wechat_publish_task
    let dbRows: Array<{
      task_id: string;
      type: string;
      target_user: string;
      approval_status: string;
      approval_source: string | null;
    }> = [];
    try {
      const sel = await pool.query(
        `SELECT task_id, type, target_user, approval_status, approval_source
           FROM zenithjoy.wechat_publish_task
          WHERE feishu_record_id = $1
          LIMIT 1`,
        [recordId],
      );
      dbRows = sel.rows ?? [];
    } catch (err) {
      console.warn(
        `[feishu-poll] DB SELECT for record_id=${recordId} 失败:`,
        err,
      );
      continue;
    }

    if (!dbRows[0]) {
      console.warn(`[feishu-poll] 飞书 ${recordId} 在 DB 找不到对应行，跳过`);
      continue;
    }
    const dbRow = dbRows[0];
    if (dbRow.approval_status !== 'pending_review') {
      // 已处理过（approved / rejected / rate_limited），不重复派
      continue;
    }

    // 2) 写 DB approval_source='feishu_user' approval_status='approved'（A 路线护栏 enforce）
    try {
      await pool.query(
        `UPDATE zenithjoy.wechat_publish_task
            SET approval_source = $1,
                approval_status = $2,
                updated_at = NOW()
          WHERE task_id = $3`,
        ['feishu_user', 'approved', dbRow.task_id],
      );
    } catch (err) {
      console.warn(
        `[feishu-poll] DB UPDATE approval_source for task=${dbRow.task_id} 失败:`,
        err,
      );
      continue;
    }

    // 3) 频控校验（chat 用 target_user 当 wechat_id；moment 用 target_user 当 wechat_id 维度 key）
    const wechatId = dbRow.target_user || 'unknown';
    const rl = checkRateLimit(type, wechatId);
    if (!rl.ok) {
      // 4) 频控拒：UPDATE rate_limit_status + next_allowed_at + approval_status='rate_limited'
      try {
        await pool.query(
          `UPDATE zenithjoy.wechat_publish_task
              SET approval_status = $1,
                  rate_limit_status = $2,
                  next_allowed_at = $3,
                  updated_at = NOW()
            WHERE task_id = $4`,
          [
            'rate_limited',
            rl.reason || 'rate_limited',
            rl.next_allowed_at || null,
            dbRow.task_id,
          ],
        );
      } catch (err) {
        console.warn(
          `[feishu-poll] DB UPDATE rate_limited for task=${dbRow.task_id} 失败:`,
          err,
        );
      }
      continue;
    }

    // 5) 派 task_dispatch（构造 Task 对象）
    const skill = type === 'moment' ? 'wechat_send_moment' : 'wechat_send_chat';
    try {
      await dispatchTask({
        id: dbRow.task_id,
        tenantId: '',
        agentId: null,
        agentText: null,
        skill,
        params: {
          task_id: dbRow.task_id,
          type,
          target_user: dbRow.target_user,
          feishu_record_id: recordId,
        },
        status: 'pending',
        result: null,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
      });
      dispatched += 1;
    } catch (err) {
      console.warn(
        `[feishu-poll] dispatchTask for task=${dbRow.task_id} 失败:`,
        err,
      );
    }
  }

  return {
    polled: allApproved.length,
    dispatched,
  };
}

/**
 * 启动 30s 周期轮询。
 */
export function startFeishuPoll(intervalMs?: number): FeishuPollHandle {
  const ms = intervalMs ?? POLL_INTERVAL_MS;
  console.log(`[feishu-poll] start interval=${ms}ms (30000 = 30s 周期)`);
  const handle: FeishuPollHandle = {
    timer: setInterval(() => {
      pollOnce().catch((err) => {
        console.warn('[feishu-poll] interval pollOnce 异常:', err);
      });
    }, ms),
  };
  return handle;
}

/**
 * 停止周期轮询。idempotent。
 */
export function stopFeishuPoll(handle: FeishuPollHandle | null | undefined): void {
  if (!handle) return;
  if (handle.timer) clearInterval(handle.timer);
}

/** 测试用：清掉飞书 token 缓存 */
export function _resetFeishuPollTokenCache(): void {
  cachedToken = null;
}
