'use strict';
// services/agent/build-modules/line04/cs-config-gate.js
//
// 客户机真发 gate 决策（纯函数，无 I/O，可被 Node agent require、也被 vitest 测）。
//
// 背景：原先客户机靠装包写死 env（REAL_PUBLISH / ZENITHJOY_AGENT_REAL_PUBLISH）决定真发/演练，
// 导致「装一次写死一次、改开关要重装」。本模块把真发 gate 改成「跟随该客服中台配置的
// auto_agent_enabled」，并对「中台不可达拉配置失败」做强制 dryrun 兜底——绝不误真发。
//
// 三个纯函数：
//   resolveSendMode(config, pullOk)        → 'real' | 'dryrun'
//   resolveActiveConfig(fresh, cached, pullOk) → config（断网期用上次缓存的自己那份继续判定）
//   shouldReply(config, senderName)        → boolean（黑名单主模型：blacklist 模式 sender∉blacklist 才回；
//                                              whitelist 模式/无 takeover_mode 回退旧白名单逻辑）

/**
 * 真发 gate 决策。
 *   - auto_agent_enabled=true 且 pullOk=true  → 'real'（真发）
 *   - auto_agent_enabled=false                → 'dryrun'（演练）
 *   - pullOk=false（拉配置失败/中台不可达）   → 'dryrun'（强制演练，绝不误真发）
 *
 * @param {{auto_agent_enabled?: boolean}|null|undefined} config 当前生效配置
 * @param {boolean} pullOk 本轮是否成功从中台拉到配置
 * @returns {'real'|'dryrun'}
 */
function resolveSendMode(config, pullOk) {
  if (!pullOk) return 'dryrun';
  return config && config.auto_agent_enabled === true ? 'real' : 'dryrun';
}

/**
 * 断网期缓存继续判定：决定本轮用哪份配置。
 *   - pullOk=true  → fresh（这一轮拉到的新配置）
 *   - pullOk=false → cached（上次缓存的自己那份，不丢配置；下游由 resolveSendMode 强制 dryrun，
 *                    中台恢复后自动重拉）
 *
 * @template T
 * @param {T} fresh 本轮拉到的新配置（拉失败时通常为 null）
 * @param {T} cached 上次成功拉到并缓存的自己那份
 * @param {boolean} pullOk 本轮是否成功拉到
 * @returns {T}
 */
function resolveActiveConfig(fresh, cached, pullOk) {
  return pullOk ? fresh : cached;
}

/**
 * 接管判定（CRM 重做：黑名单主模型 + whitelist 兼容回退，与 cs_config_gate.py should_reply 同语义）。
 *
 * takeover_mode 决定语义（决策 1，lead 拍板）：
 *   - 'blacklist'（新接入客服机主模型）：默认全接管，senderName ∉ blacklist 才回。
 *     空黑名单 / blacklist 非数组（脏数据）→ 当空处理 → 全员回。
 *   - 'whitelist' / 无 takeover_mode（存量旧配置）：回退旧逻辑——senderName ∈ whitelist 才回。
 *     绝不让存量客服机一升级就突变成全接管误发。
 *
 * @param {{takeover_mode?: string, whitelist?: string[], blacklist?: string[]}|null|undefined} config
 * @param {string} senderName 来消息的发件人名
 * @returns {boolean}
 */
function shouldReply(config, senderName) {
  if (!config) return false;
  if (config.takeover_mode === 'blacklist') {
    const bl = Array.isArray(config.blacklist) ? config.blacklist : [];
    return !bl.includes(senderName);
  }
  const wl = Array.isArray(config.whitelist) ? config.whitelist : [];
  return wl.includes(senderName);
}

module.exports = { resolveSendMode, resolveActiveConfig, shouldReply };
