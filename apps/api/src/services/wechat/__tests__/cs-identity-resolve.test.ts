/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * cs-identity-resolve 单测 —— 客服身份三段解析链（与 wechat-draft.generateChatDraft 逐字一致）：
 *   直传 cs_wechat_id  >  csConfig?.wechat_id（getCSConfigByAgentId）  >  resolveCsWechatIdByAgentId(agent_id)
 *
 * 关键回归（Line04 假账反向复发）：手填 SSOT 场景下 csConfig.wechat_id 可能与 service_agents 反查值
 * 不一致；draft 写行盖的是 csConfig 值，回执必须用同一条链解出同一值，否则 UPDATE 0 行、draft 卡死。
 * 跨模块 mock cs-account-config-store 的两个原语，让真实 resolveCsWechatIdentity 跑三段短路。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../cs-account-config-store', () => ({
  getCSConfigByAgentId: vi.fn(),
  resolveCsWechatIdByAgentId: vi.fn(),
}));

import {
  getCSConfigByAgentId,
  resolveCsWechatIdByAgentId,
} from '../cs-account-config-store';
import { resolveCsWechatIdentity } from '../cs-identity-resolve';

beforeEach(() => vi.clearAllMocks());

describe('resolveCsWechatIdentity', () => {
  it('直传 cs_wechat_id 最高优先，不查 csConfig / 不做反查', async () => {
    const id = await resolveCsWechatIdentity({ directCsWechatId: 'cs-direct', agentId: 'agent-1' });
    expect(id).toBe('cs-direct');
    expect(getCSConfigByAgentId).not.toHaveBeenCalled();
    expect(resolveCsWechatIdByAgentId).not.toHaveBeenCalled();
  });

  it('无直传：csConfig.wechat_id 与反查值不同 → 按 csConfig 优先（防假账反向复发）', async () => {
    (getCSConfigByAgentId as any).mockResolvedValue({ wechat_id: 'cs-config' });
    (resolveCsWechatIdByAgentId as any).mockResolvedValue('cs-reverse');
    const id = await resolveCsWechatIdentity({ agentId: 'agent-1' });
    // csConfig 命中即短路，绝不落到反查值
    expect(id).toBe('cs-config');
    expect(getCSConfigByAgentId).toHaveBeenCalledWith('agent-1');
    expect(resolveCsWechatIdByAgentId).not.toHaveBeenCalled();
  });

  it('无直传：csConfig 为 null → 回落 resolveCsWechatIdByAgentId', async () => {
    (getCSConfigByAgentId as any).mockResolvedValue(null);
    (resolveCsWechatIdByAgentId as any).mockResolvedValue('cs-reverse');
    const id = await resolveCsWechatIdentity({ agentId: 'agent-1' });
    expect(id).toBe('cs-reverse');
    expect(resolveCsWechatIdByAgentId).toHaveBeenCalledWith('agent-1');
  });

  it('无直传且无 agentId → null（三段全落空，不解析）', async () => {
    const id = await resolveCsWechatIdentity({});
    expect(id).toBeNull();
    expect(getCSConfigByAgentId).not.toHaveBeenCalled();
    expect(resolveCsWechatIdByAgentId).not.toHaveBeenCalled();
  });

  it('调用方已加载 csConfig 时传入复用，不再查库（generateChatDraft 复用 persona 那份）', async () => {
    (resolveCsWechatIdByAgentId as any).mockResolvedValue('cs-reverse');
    const id = await resolveCsWechatIdentity({
      agentId: 'agent-1',
      csConfig: { wechat_id: 'cs-preloaded' } as any,
    });
    expect(id).toBe('cs-preloaded');
    expect(getCSConfigByAgentId).not.toHaveBeenCalled();
    expect(resolveCsWechatIdByAgentId).not.toHaveBeenCalled();
  });

  it('传入的 csConfig 无 wechat_id → 回落反查', async () => {
    (resolveCsWechatIdByAgentId as any).mockResolvedValue('cs-reverse');
    const id = await resolveCsWechatIdentity({
      agentId: 'agent-1',
      csConfig: null,
    });
    expect(id).toBe('cs-reverse');
    expect(getCSConfigByAgentId).not.toHaveBeenCalled();
  });
});
