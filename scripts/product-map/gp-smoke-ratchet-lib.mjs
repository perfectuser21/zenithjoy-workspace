/**
 * gp-smoke-ratchet-lib.mjs — GP 无 smoke 覆盖计数（零依赖纯函数）
 *
 * 单独成文件的原因（0730 巡检首跑实证）：CLI gp-smoke-ratchet.mjs 此前从 lib.mjs
 * 取本函数，lib.mjs 顶层 import ajv/yaml——主 checkout 无 node_modules 时 CLI 直接
 * ERR_MODULE_NOT_FOUND 崩掉，ci-patrol 数据源⑦断供。本模块只用语言内建，任何环境可跑。
 * lib.mjs re-export 本函数维持既有 caller（单测）不变。
 */

/**
 * GP锚定闭环 刀5 — patrol 棘轮指标：统计 smoke_files 缺失/空的 GP 数量。
 * 只做 GP 粒度（非 step 粒度 — 非目标②已拍板）。Report-only，不作 CI 硬闸。
 * deprecated 条目不计入：退役 GP（如 0729 客户线拆分保留的老 id 锚点）永远不会
 * 补 smoke，计入会让棘轮被历史条目永久虚高、真实缺口反而被淹没。
 *
 * @returns { gp_no_smoke_count: number, gp_no_smoke_ids: string[] }
 */
export function computeGpSmokeRatchet(map) {
  const ids = (map.golden_paths || [])
    .filter(gp => gp.status !== 'deprecated')
    .filter(gp => !gp.smoke_files || gp.smoke_files.length === 0)
    .map(gp => gp.id);
  return { gp_no_smoke_count: ids.length, gp_no_smoke_ids: ids };
}
