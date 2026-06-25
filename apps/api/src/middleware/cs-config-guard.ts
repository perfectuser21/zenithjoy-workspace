/**
 * cs-config-guard — 客服配置写接口安全闸（管理员角色闸 + 租户隔离，deny by default）
 *
 * 钉死 Issue 96db53be P1：`PUT /cs/config/:wechatId`、`PUT /cs/setup/:machineId`、
 * `PUT /cs/auto-agent` 原本无「管理员 + 租户隔离」闸 → 任何登录用户可改任意客服配置 = 串台。
 *
 * 用法（与 tenantContext 串联，tenantContext 必须排在前面以填 req.tenantId / req.tenantRole）：
 *   router.put('/cs/config/:wechatId', tenantContext, requireCsAdmin, requireSameTenant('wechatId'), handler)
 *   router.put('/cs/setup/:machineId',  tenantContext, requireCsAdmin, requireSameTenant('machineId'), handler)
 *   router.put('/cs/auto-agent',        tenantContext, requireCsAdmin, handler)  // 全局单行，无跨租户目标
 *
 * 拒绝响应统一用嵌套 error.code 形状（与 tenantContext / customer-admin 一致）：
 *   403 NOT_ADMIN        — member / 无 role（非 owner/admin）
 *   403 CROSS_TENANT     — 目标客服属别家租户
 *   404 TARGET_NOT_FOUND — 目标客服解析不到所属租户（deny by default，绝不放行写库）
 *   （401 UNAUTHORIZED / 403 NO_TENANT 由上游 tenantContext 负责）
 */
import type { Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { superAdminGuard } from './super-admin';
import { tenantContext } from './tenant-context';

/** 视为「管理员」的角色（super-admin 来自 tenantContext 的 X-Bypass-Tenant 通道） */
const ADMIN_ROLES = new Set(['owner', 'admin', 'super-admin']);

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

/**
 * 角色闸：要求 tenantContext 已解出 req.tenantRole ∈ {owner, admin, super-admin}。
 * member / 无 role → 403 NOT_ADMIN（前台据此显示「仅管理员可配置」）。
 */
export function requireCsAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.tenantRole;
  if (!role || !ADMIN_ROLES.has(role)) {
    deny(res, 403, 'NOT_ADMIN', '仅管理员可配置（需 owner / admin 角色）');
    return;
  }
  next();
}

/** 当前请求是否带「legacy 服务/超管」凭证（飞书白名单 id、邮箱超管 或 internal token）。 */
function hasLegacyServiceCredential(req: Request): boolean {
  const feishuId =
    typeof req.headers['x-feishu-user-id'] === 'string'
      ? req.headers['x-feishu-user-id'].trim()
      : '';
  const adminIds = (process.env.ADMIN_FEISHU_OPENIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (feishuId !== '' && adminIds.includes(feishuId)) return true;

  // 邮箱超管通道（修 403）：X-User-Email ∈ ADMIN_EMAILS → 走 superAdminGuard 的邮箱路径（super-admin.ts:60-76）。
  // 没有这一旁路时，邮箱超管（无飞书头、无 token）会落到裸 tenantContext，而超管邮箱常不属任何租户 → 403。
  const userEmail =
    typeof req.headers['x-user-email'] === 'string'
      ? req.headers['x-user-email'].trim().toLowerCase()
      : '';
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (userEmail !== '' && adminEmails.includes(userEmail)) return true;

  const authz = req.headers.authorization || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length).trim() : '';
  const internalHeader =
    typeof req.headers['x-internal-token'] === 'string' ? req.headers['x-internal-token'].trim() : '';
  return bearer !== '' || internalHeader !== '';
}

/**
 * /cs/auto-agent 专用闸（全局单行配置，无 per-tenant 目标）：兼容两条管理员通道——
 *   1) legacy 服务/超管：飞书白名单 id 或 internal token（superAdminGuard）——保留「中台→出站任务」服务流
 *   2) dashboard 租户管理员：better-auth session / 非白名单 X-Feishu-User-Id → tenant_members owner/admin
 * 二者皆不满足（member / 无凭证）→ 403（NOT_ADMIN 经租户路径 / FORBIDDEN 经超管路径）。
 */
export function requireCsAdminOrSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (hasLegacyServiceCredential(req)) {
    superAdminGuard(req, res, next);
    return;
  }
  // 无 legacy 凭证 → 走 dashboard 租户 session 管理员闸
  tenantContext(req, res, () => requireCsAdmin(req, res, next));
}

/**
 * /cs/config/:wechatId、/cs/setup/:machineId 写接口闸（带 per-tenant 目标隔离）：
 *   1) legacy 服务/超管：飞书白名单 id 或 internal token（superAdminGuard）——保留服务/自动化写入流，
 *      与 super-admin 一样跨租户放行（service-level 写入按 wechat_id/machine_id 物理分行已天然隔离）。
 *   2) dashboard 租户管理员：tenantContext → requireCsAdmin → requireSameTenant(kind)（角色闸 + 租户隔离）。
 * member / 无凭证 → 403/401；跨租户 dashboard 用户 → 403 CROSS_TENANT；解析不出目标 → 404 TARGET_NOT_FOUND。
 */
export function requireCsWriteAccess(kind: 'wechatId' | 'machineId') {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (hasLegacyServiceCredential(req)) {
      superAdminGuard(req, res, next);
      return;
    }
    tenantContext(req, res, () =>
      requireCsAdmin(req, res, () => requireSameTenant(kind)(req, res, next))
    );
  };
}

/**
 * 读接口多通道闸（修正6：GET /api/crm/customers、GET /api/crm/onboarding 复用写接口同款多通道，修 403）：
 *   1) legacy 服务/超管：飞书白名单 id 或 internal token / Bearer（superAdminGuard）→ 放行（super-admin 看自己关心的客服机）。
 *   2) dashboard 租户用户：tenantContext → req.tenantId scope（租户 owner/admin/member 都能读**自己**客服机好友表，
 *      读接口不要求 admin 角色——全员可用，写才要 requireCsAdmin）。
 * member / 无凭证 → 401/403 由 tenantContext 负责。与裸 tenantContext 的区别：多了 legacy/super-admin 旁路（修 session-only super-admin 403）。
 */
export function requireCsReadAccess(req: Request, res: Response, next: NextFunction): void {
  if (hasLegacyServiceCredential(req)) {
    superAdminGuard(req, res, next);
    return;
  }
  // 无 legacy 凭证 → 走 dashboard 租户 session（不加角色闸，读接口全员可用）
  tenantContext(req, res, next);
}

/**
 * 服务/agent 专用闸（ingest 上报 + onboarding 回写：agent 无人类 session，只走 internal/service token）。
 * 直接复用 superAdminGuard（不读 better-auth session，天然挡人类 dashboard cookie 用户）——三态：
 *   - ZENITHJOY_INTERNAL_TOKEN **已设** + 合法 X-Internal-Token/Bearer/超管飞书头 → 放行；无/错凭证 → 401。
 *   - ZENITHJOY_INTERNAL_TOKEN **未设**（dev/CI）+ 不带头 → dev 放行。
 * 这与 agent 侧 post_friend_scan「env 未设时不带 X-Internal-Token 头」严格对齐（跨 teammate 契约，PR#860）：
 * 生产必设 token 才成闸；dev/CI 未设 token 时 agent 不带头、后端放行，两端一致不互锁。
 */
export function requireServiceCredential(req: Request, res: Response, next: NextFunction): void {
  superAdminGuard(req, res, next);
}

/** 目标客服（wechat_id）→ 所属租户 tenant_id；查不到返回 null。 */
async function resolveTenantByWechatId(wechatId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT tenant_id
       FROM zenithjoy.service_agents
      WHERE wechat_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [wechatId]
  );
  return (r.rows?.[0]?.tenant_id as string | undefined) ?? null;
}

/** 目标客服机（machine_id）→ 所属租户 tenant_id（license_machines JOIN licenses，与 setupCSByMachine 同源）；查不到返回 null。 */
async function resolveTenantByMachineId(machineId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT l.tenant_id
       FROM zenithjoy.license_machines lm
       JOIN zenithjoy.licenses l ON l.id = lm.license_id
      WHERE lm.machine_id = $1
      ORDER BY lm.last_seen DESC
      LIMIT 1`,
    [machineId]
  );
  return (r.rows?.[0]?.tenant_id as string | undefined) ?? null;
}

/**
 * 租户隔离闸 factory：按路径参数（wechatId / machineId）解析目标客服所属租户，
 * 与当前用户租户比对。deny by default — 解析不出目标租户绝不放行写库。
 */
export function requireSameTenant(kind: 'wechatId' | 'machineId') {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = (req.params[kind] ?? '').trim();
    if (!key) {
      deny(res, 404, 'TARGET_NOT_FOUND', '目标客服标识缺失，已拒绝写入（deny by default）');
      return;
    }

    let targetTenant: string | null;
    try {
      targetTenant =
        kind === 'wechatId'
          ? await resolveTenantByWechatId(key)
          : await resolveTenantByMachineId(key);
    } catch (err) {
      deny(res, 500, 'TARGET_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
      return;
    }

    // deny by default：解析不到目标租户 → 绝不默认放行到任一租户
    if (!targetTenant) {
      deny(res, 404, 'TARGET_NOT_FOUND', '目标客服解析不到所属租户，已拒绝写入（deny by default）');
      return;
    }

    // super-admin（X-Bypass-Tenant 通道）放行；否则目标租户必须 == 当前用户租户
    if (req.tenantRole !== 'super-admin' && targetTenant !== req.tenantId) {
      deny(res, 403, 'CROSS_TENANT', '不能修改其他租户的客服配置（租户隔离）');
      return;
    }

    next();
  };
}
