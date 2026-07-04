/**
 * apps/api/src/services/wechat/cs-identity-resolve.ts —— 客服身份三段解析链（单一真源）
 *
 * 抽出 generateChatDraft（wechat-draft.ts）里长期使用的三段短路链，供「写行」与「回执」两处共用，
 * 逐字一致：
 *   直传 cs_wechat_id  ??  csConfig?.wechat_id  ??  resolveCsWechatIdByAgentId(agentId)
 *
 * 为什么必须一致：draft 写 out 行时盖的 cs_wechat_id 来自这条链；回执 UPDATE 的归属条件
 * （cs_wechat_id = 本客服）也必须由同一条链解出同一值。手填 SSOT 场景下 csConfig.wechat_id 可能
 * 与 service_agents 反查值不一致，若回执少了中间 csConfig 段 → 解出不同值 → UPDATE 0 行 →
 * out 行永久卡 draft → 中台记了但真机没确认送达的「假账」反向复发。
 *
 * 放独立模块（而非 cs-account-config-store）是为可测：本函数跨模块调用两个原语，
 * 单测可 mock cs-account-config-store 直接驱动三段短路。
 */
import {
  getCSConfigByAgentId,
  resolveCsWechatIdByAgentId,
  type CSAccountConfig,
} from './cs-account-config-store';

export interface ResolveCsIdentityInput {
  /** 直传客服微信号（smoke / 已知身份的调用方），最高优先。 */
  directCsWechatId?: string | null;
  /** agent 身份：用于查 csConfig 与反查 service_agents。 */
  agentId?: string | null;
  /**
   * 调用方已加载的每客服配置（如 generateChatDraft 为 persona 已查过），传入即复用、不再查库；
   * 省略（undefined）时本函数按需自查。显式传 null = 已知无配置，直接跳到反查段。
   */
  csConfig?: CSAccountConfig | null;
}

/**
 * 解析「处理本消息/回执的客服微信号」。解不到 → null（不盖身份章 / 不翻任意行）。
 * 语义与 generateChatDraft 内 `params.cs_wechat_id ?? csConfig?.wechat_id ?? resolveCsWechatIdByAgentId` 逐字一致。
 */
export async function resolveCsWechatIdentity(
  input: ResolveCsIdentityInput,
): Promise<string | null> {
  const { directCsWechatId, agentId } = input;
  // 段1：直传优先（?? 语义：仅 null/undefined 才下沉，'' 等按原值保留）
  if (directCsWechatId != null) return directCsWechatId;
  if (!agentId) return null;
  // 段2：csConfig?.wechat_id —— 调用方已加载则复用（含显式 null），否则自查
  const csConfig =
    input.csConfig !== undefined ? input.csConfig : await getCSConfigByAgentId(agentId);
  if (csConfig?.wechat_id != null) return csConfig.wechat_id;
  // 段3：service_agents 反查
  return resolveCsWechatIdByAgentId(agentId);
}
