/**
 * check.mjs — 采证前置校验工具（无浏览器依赖，供单测直接 import）
 *
 * D2 FR-2：双自检（assertTenantAndDevice）
 *   - 登录租户 == ACCEPTANCE_TENANT_ID
 *   - run-summary.machines_online >= 1
 */

/**
 * assertTenantAndDevice — 开跑前双自检
 *
 * @param {object} opts
 * @param {string} opts.stagingUrl           staging 根 URL
 * @param {string|null} opts.acceptanceTenantId  ACCEPTANCE_TENANT_ID 期望值（null 则跳过 tenant 校验）
 * @param {number} opts.machinesOnline       当前在线机器数
 * @param {Function} [opts.fetchFn]          fetch 替换（供单测注入）
 * @throws {Error} tenant 不匹配或 machines_online < 1 时抛出（含 ai_incomplete 关键字）
 */
export async function assertTenantAndDevice({ stagingUrl, acceptanceTenantId, machinesOnline, fetchFn }) {
  const _fetch = fetchFn || globalThis.fetch;

  // 校验 1：登录租户 == ACCEPTANCE_TENANT_ID（仅当配置了 ACCEPTANCE_TENANT_ID 时强检）
  if (acceptanceTenantId) {
    let tenantId;
    try {
      const resp = await _fetch(`${stagingUrl}/api/me`, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`/api/me 返回 ${resp.status}`);
      const j = await resp.json();
      tenantId = j?.tenant_id;
    } catch (e) {
      throw new Error(`双自检失败：/api/me 不可达或解析失败 → ai_incomplete 退出 (${e.message})`);
    }
    if (tenantId !== acceptanceTenantId) {
      throw new Error(
        `双自检失败：tenant 不匹配（期望 ${acceptanceTenantId}，实际 ${tenantId}）→ ai_incomplete 退出`
      );
    }
  }

  // 校验 2：machines_online >= 1
  if (typeof machinesOnline === 'number' && machinesOnline < 1) {
    throw new Error(
      `双自检失败：machines_online=${machinesOnline} < 1，无在线 machine → ai_incomplete 退出`
    );
  }
}
