/**
 * worker 执行器面 POST 鉴权 — 内部 token 或 agent 自身 license 二选一
 *
 * 背景：/api/workers 执行器面原本只认内部编排 token（ZENITHJOY_INTERNAL_TOKEN），
 * 那是给 n8n / creator-api 这类本机调用方用的。客户机上的 agent 拿不到、也不该拿到
 * 这个全局 token —— 它只有装机时发的 license_key。为了让 agent 能自己推屏幕帧
 * （POST /:agentId/frame），加一条以 agent 自身凭据为准的放行路径。
 *
 * 规则：
 *  - 内部 token 路径逻辑完全不变（委托给 internalAuth，单一事实来源）
 *  - agent license 走请求头 X-Agent-License: <license_key>
 *    · 刻意不复用 Authorization: Bearer，避免和内部 token 抢同一个头
 *  - license 只对 URL 里带 :agentId 的路由有效（/:agentId/tasks、/:agentId/frame）。
 *    /tasks/:id/steps、/tasks/:id/complete 路径上没有 agent 身份可比对，无法验证
 *    租户归属，故仍只认内部 token —— 这些是编排侧调用，不是 agent 调用。
 *  - 租户必须一致：license 的 tenant 必须等于该 agent 的 tenant，否则 403。
 *    否则任一租户的合法 license 就能往别人机器的帧缓冲里灌画面。
 *
 * 状态码：401 未提供/无效凭据 · 403 license 状态不可用或跨租户 · 404 agent 不存在
 */

import type { Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { internalAuth } from './internal-auth';
import { validateLicense } from '../services/walking-skeleton.service';

/**
 * router.use 层拿不到 req.params（express 只在路由匹配后填充），所以 agentId 只能从
 * 路径自己解析。与 workers-executor 的 UUID_RE 同形。
 */
const AGENT_PATH_RE =
  /^\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\//i;

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

function extractAgentLicense(req: Request): string | null {
  const v = req.headers['x-agent-license'];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function agentIdFromPath(path: string): string | null {
  return AGENT_PATH_RE.exec(path)?.[1] ?? null;
}

/**
 * 以 agent 自身 license 鉴权：license 有效 且 与路径上的 agent 同租户 → next()。
 */
export async function workerAgentAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const key = extractAgentLicense(req);
  if (!key) {
    return fail(res, 401, 'UNAUTHORIZED', '缺少 agent 凭据。请在请求头加 X-Agent-License: <license_key>');
  }

  const agentId = agentIdFromPath(req.path);
  if (!agentId) {
    return fail(res, 401, 'UNAUTHORIZED', 'agent license 仅适用于 /api/workers/:agentId/* 端点，其余端点需内部 token');
  }

  let result;
  try {
    result = await validateLicense(key);
  } catch (err) {
    return fail(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
  }
  if (!result.ok) {
    // INVALID_LICENSE = 认不出这张证 → 401；其余（REVOKED/SUSPENDED/EXPIRED/NO_TENANT）
    // = 证认得出但不给用 → 403，与 licenseAuth 中间件口径一致。
    return fail(res, result.code === 'INVALID_LICENSE' ? 401 : 403, result.code, result.message);
  }

  let agentTenantId: string | null;
  try {
    const { rows } = await pool.query<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM zenithjoy.agents WHERE id = $1',
      [agentId]
    );
    if (rows.length === 0) {
      return fail(res, 404, 'AGENT_NOT_FOUND', 'agent 不存在（zenithjoy.agents.id）');
    }
    agentTenantId = rows[0].tenant_id;
  } catch (err) {
    return fail(res, 500, 'AGENT_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
  }

  if (!agentTenantId || agentTenantId !== result.license.tenant_id) {
    return fail(res, 403, 'TENANT_MISMATCH', 'license 与该 agent 不属于同一租户');
  }

  req.license = result.license;
  next();
}

/**
 * 执行器面 POST 鉴权入口：内部 token 或 agent license，任一过即放行。
 *
 * 只对 POST 生效 —— 本 router 与 workers-read 的读面串联挂在同一 /api/workers 前缀下，
 * 无差别拦所有方法会让 GET 在到达读面之前先被 401 掉。
 */
export function workerPostAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST') return next();

  // env 未设置（dev 放行）、或压根没带 agent license → 完全走原有 internalAuth，
  // 行为与本改动之前逐字一致（含 dev 模式 warn 与 401 文案）。
  if (!process.env.ZENITHJOY_INTERNAL_TOKEN || !extractAgentLicense(req)) {
    return internalAuth(req, res, next);
  }

  void workerAgentAuth(req, res, next);
}
