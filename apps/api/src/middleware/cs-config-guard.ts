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
import { validateLicense } from '../services/walking-skeleton.service';

/** 视为「管理员」的角色（super-admin 来自 tenantContext 的 X-Bypass-Tenant 通道） */
const ADMIN_ROLES = new Set(['owner', 'admin', 'super-admin']);

/** license key 形如 ZJ-[FBMSE]-XXXXXXXX；据此把 agent license 自证与 internal token 区分开。 */
const LICENSE_KEY_PATTERN = /^ZJ-[FBMSE]-[A-Z0-9]{8}$/;

/**
 * 从请求里取「看起来像 agent license」的 key（Gap1 自证）：
 *   1. X-License-Key 头（agent 上报专用，最明确）
 *   2. Authorization: Bearer <ZJ-...>（仅当值匹配 license 格式时；普通 internal token Bearer 不在此列）
 * 取不到返回 null（→ 调用方回落到 internal token / super-admin 路径）。
 */
function extractAgentLicenseKey(req: Request): string | null {
  const headerKey =
    typeof req.headers['x-license-key'] === 'string' ? req.headers['x-license-key'].trim() : '';
  if (headerKey && LICENSE_KEY_PATTERN.test(headerKey)) return headerKey;

  const authz = req.headers.authorization || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length).trim() : '';
  if (bearer && LICENSE_KEY_PATTERN.test(bearer)) return bearer;

  return null;
}

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
 * 服务/agent 专用闸（ingest 上报 + onboarding 回写：agent 无人类 session）。
 *
 * Gap1 修复（2026-06-25）：agent 自证身份，不再依赖客户端 .env 烧共享 internal token。
 *   下载烧进 agent .env 的只有 LICENSE（注册/心跳已用 license 认证），共享 internal token 不该下发到每台
 *   客户端（泄漏即全租户沦陷）。所以 agent 上报时带 X-License-Key（或 Bearer <ZJ-...>）自证：
 *   - 带「合法 license（active + 已绑 tenant）」→ 校验通过即放行，并把 license.tenant_id 挂到 req.tenantId，
 *     供 handler 做同租户隔离（cs_wechat_id 必须属该 tenant）。无效/吊销/过期 → 401。
 *   - 不带 license → 回落到原 superAdminGuard 通道（向后兼容 internal token / 超管飞书头 / dev 放行）：
 *       · ZENITHJOY_INTERNAL_TOKEN 已设 + 合法 token/超管头 → 放行；无/错 → 401。
 *       · ZENITHJOY_INTERNAL_TOKEN 未设（dev/CI）+ 不带头 → dev 放行。
 * 这样：真 agent（只有 license、无 internal token）也能 ingest；老的 internal token 服务流照旧不破。
 */
export async function requireServiceCredential(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const licenseKey = extractAgentLicenseKey(req);
  if (licenseKey) {
    try {
      const result = await validateLicense(licenseKey);
      if (result.ok && result.license.tenant_id) {
        // license 自证通过：挂 tenantId，handler 据此做同租户隔离（cs_wechat_id 必属此 tenant）。
        req.tenantId = result.license.tenant_id;
        next();
        return;
      }
      // license 存在但无效（吊销/过期/无 tenant）/ 不存在 → 拒绝（不再回落 token，避免越权）。
      deny(res, 401, 'INVALID_LICENSE', result.ok ? 'license 未关联 tenant' : result.message);
      return;
    } catch (err) {
      deny(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
      return;
    }
  }
  // 无 agent license → 走原 internal token / 超管 / dev 通道（向后兼容）
  superAdminGuard(req, res, next);
}

/**
 * 修 D：目标客服（wechat_id）→ 所属租户候选**集合**（不止一条）。
 *
 * 号→租户解析历史两条路不一致（同一机器 cs-<前缀> 在 license_machines 可有多行属不同租户）。
 * 旧实现只查 service_agents 单行：cs 微信号在 service_agents 没行（绑了但断链）→ 解不到 → 接管开关 404；
 * 或只看一条 → 误判 CROSS_TENANT 403。改为收集所有候选：
 *   ① service_agents.tenant_id（按 wechat_id）
 *   ② 回退 machine→license 链：wechat_id 形如 cs-<machine_id 前缀>（setupCSByMachine 自动派生名约定）
 *      → license_machines.machine_id LIKE 前缀% → licenses.tenant_id（可能多行多租户，全收）。
 * 调用方按「当前租户 ∈ 候选」放行（别只看一条）。友好名（非 cs-前缀）无法派生 machine → 只走 ①。
 */
async function resolveTenantCandidatesByWechatId(wechatId: string): Promise<string[]> {
  const set = new Set<string>();
  const sa = await pool.query(
    `SELECT tenant_id
       FROM zenithjoy.service_agents
      WHERE wechat_id = $1 AND deleted_at IS NULL`,
    [wechatId]
  );
  for (const r of sa.rows ?? []) if (r.tenant_id) set.add(String(r.tenant_id));

  // 回退 machine→license 链：仅当 wechat_id 是 cs-<hex 前缀>（自动派生名）时可逆推 machine_id。
  const m = /^cs-([0-9a-fA-F]{6,})$/.exec(wechatId);
  if (m) {
    const prefix = m[1].toLowerCase();
    const lm = await pool.query(
      `SELECT l.tenant_id
         FROM zenithjoy.license_machines lm
         JOIN zenithjoy.licenses l ON l.id = lm.license_id
        WHERE lm.machine_id LIKE $1 || '%'`,
      [prefix]
    );
    for (const r of lm.rows ?? []) if (r.tenant_id) set.add(String(r.tenant_id));
  }
  return Array.from(set);
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

    // wechatId：解析候选租户集合（service_agents ∪ machine→license 链，修 D 接管开关 403/404）；
    // machineId：单一来源（license_machines JOIN licenses）。
    let candidates: string[];
    try {
      candidates =
        kind === 'wechatId'
          ? await resolveTenantCandidatesByWechatId(key)
          : await (async () => {
              const t = await resolveTenantByMachineId(key);
              return t ? [t] : [];
            })();
    } catch (err) {
      deny(res, 500, 'TARGET_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
      return;
    }

    // deny by default：两条路都解不到目标租户 → 绝不默认放行到任一租户
    if (candidates.length === 0) {
      deny(res, 404, 'TARGET_NOT_FOUND', '目标客服解析不到所属租户，已拒绝写入（deny by default）');
      return;
    }

    // super-admin（X-Bypass-Tenant 通道）放行；否则当前用户租户必须在候选集合内（别只看一条）。
    if (req.tenantRole !== 'super-admin' && !(req.tenantId && candidates.includes(req.tenantId))) {
      deny(res, 403, 'CROSS_TENANT', '不能修改其他租户的客服配置（租户隔离）');
      return;
    }

    next();
  };
}
