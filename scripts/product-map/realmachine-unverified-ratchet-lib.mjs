/**
 * realmachine-unverified-ratchet-lib.mjs — 真机验证车道未覆盖标记计数（零依赖纯函数）
 *
 * 单独成文件的原因（2026-07-30 proven-to-fire 演练首次接入 CI 硬闸时实证，跟进
 * gp-smoke-ratchet-lib.mjs 同款教训）：CLI realmachine-unverified-ratchet.mjs 此前从
 * lib.mjs 取本函数，lib.mjs 顶层 import ajv/yaml——主 checkout 无 node_modules 时
 * （如新增的 lint-realmachine-unverified-ratchet.sh CI job，PR 门禁追求快、不跑
 * npm ci）CLI 直接 ERR_MODULE_NOT_FOUND 崩掉，硬闸形同虚设。本模块只用语言内建，
 * 任何环境可跑。lib.mjs re-export 本函数维持既有 caller（单测）不变。
 */

/**
 * 真机验证车道三层防假绿守卫 · 第3层 — patrol 棘轮指标：统计"带 [CI-MOCK] 但无对应
 * nightly 真机 job 覆盖"的步骤数。纯函数，输入已解析对象，不做文件 I/O（跟进
 * computeGpSmokeRatchet 同款模式）。
 *
 * @param {{file: string, line: number, nightlyRef: string|null}[]} markers
 *   已从 golden-path-*-smoke.sh 里扫描出的 [CI-MOCK: real-device-only | nightly_ref: X] 标记
 * @param {string} nightlyYaml
 *   nightly-real-machine-staging.yml 的原始文本内容
 * @returns { realmachine_unverified_count: number, realmachine_unverified_ids: string[] }
 */
export function computeRealmachineUnverifiedRatchet(markers, nightlyYaml) {
  const ids = [];
  for (const marker of (markers || [])) {
    const covered = !!marker.nightlyRef && nightlyYaml.includes(marker.nightlyRef);
    if (!covered) {
      ids.push(`${marker.file}:${marker.line}`);
    }
  }
  return { realmachine_unverified_count: ids.length, realmachine_unverified_ids: ids };
}
