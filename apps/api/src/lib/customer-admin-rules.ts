/**
 * 客户管理后台业务规则 — Line 10
 *
 * 纯函数护栏（不碰 DB），供路由层与单元测试共用：
 *   - isValidRole：子账号角色枚举校验（admin | operator | service_agent）
 *   - assertBindable：只有 service_agent 角色可绑 PC，否则抛 INVALID_BIND_ROLE
 *
 * 这些规则是合同声明的硬阈值，单元测试（sprints/.../tests）import 失败即红。
 */

/** 子账号合法角色（PRD 第 2 步字面：admin | operator | service_agent） */
export const VALID_SUB_ACCOUNT_ROLES = ['admin', 'operator', 'service_agent'] as const;

export type SubAccountRole = (typeof VALID_SUB_ACCOUNT_ROLES)[number];

/** 错误码（与 contract-draft.md Response Schema 对齐） */
export const CUSTOMER_ADMIN_ERROR_CODES = {
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_ROLE: 'INVALID_ROLE',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  SUBACCOUNT_QUOTA_EXCEEDED: 'SUBACCOUNT_QUOTA_EXCEEDED',
  ALREADY_BOUND: 'ALREADY_BOUND',
  MACHINE_QUOTA_EXCEEDED: 'MACHINE_QUOTA_EXCEEDED',
  INVALID_BIND_ROLE: 'INVALID_BIND_ROLE',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  BINDING_NOT_FOUND: 'BINDING_NOT_FOUND',
} as const;

/** 角色是否合法 */
export function isValidRole(role: unknown): role is SubAccountRole {
  return typeof role === 'string' && (VALID_SUB_ACCOUNT_ROLES as readonly string[]).includes(role);
}

/**
 * 校验账号可被绑定到 PC —— 只有 service_agent 角色可绑。
 * 非该角色抛错（错误 message 含 service_agent / INVALID_BIND_ROLE 供守卫与测试匹配）。
 */
export function assertBindable(account: { role: string }): void {
  if (account.role !== 'service_agent') {
    const err = new Error(
      `INVALID_BIND_ROLE: 只有 service_agent 角色可绑 PC，当前角色 ${account.role}`
    );
    (err as Error & { code?: string }).code = CUSTOMER_ADMIN_ERROR_CODES.INVALID_BIND_ROLE;
    throw err;
  }
}
