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
//   shouldReply(config, senderName)        → boolean（senderName 在 config.whitelist 内才回）

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
 * 白名单判定：发件人在 config.whitelist 内才回。
 *
 * @param {{whitelist?: string[]}|null|undefined} config 当前生效配置
 * @param {string} senderName 来消息的发件人名
 * @returns {boolean}
 */
function shouldReply(config, senderName) {
  const wl = config && Array.isArray(config.whitelist) ? config.whitelist : [];
  return wl.includes(senderName);
}

module.exports = { resolveSendMode, resolveActiveConfig, shouldReply };
