/**
 * 子账号配额映射 — Line 10 客户管理后台
 *
 * 子账号上限随 license tier（zenithjoy.licenses.tier 枚举）映射。
 * 合同决策（[AI_ADDED]，PRD 只给「3~5 个」+「跟随 license plan」）：
 *   free=0 / basic=3 / matrix=5 / studio=10 / enterprise=30
 *
 * 注意：验收测试不硬编码这些数值，而是建满 quota.limit 后断言 limit+1 被拒，
 * limit 从 API quota.limit 读回 —— 改这里的映射不会让测试假绿。
 */

/** license tier → 子账号上限 */
export const SUB_ACCOUNT_LIMITS: Record<string, number> = {
  free: 0,
  basic: 3,
  matrix: 5,
  studio: 10,
  enterprise: 30,
};

/**
 * 按 license tier 计算子账号上限。
 * 未知 tier（无 license / 脏数据）按最保守的 0 处理，避免越权多建。
 */
export function computeSubAccountLimit(tier: string | null | undefined): number {
  if (!tier) return 0;
  const limit = SUB_ACCOUNT_LIMITS[tier];
  return typeof limit === 'number' ? limit : 0;
}
