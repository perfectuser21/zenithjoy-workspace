import { describe, it, expect } from 'vitest';
// 目标模块尚未实现 → import 即红（TDD Red）
import {
  handleDouyinDmOutreach,
  mapDmStatusToFeishu,
  type DmOutreachResult,
} from '../../../services/agent/src/handlers/douyin-dm-outreach';

describe('douyin-dm-outreach handler [BEHAVIOR]', () => {
  it('mapDmStatusToFeishu: sent → 已私信', () => {
    expect(mapDmStatusToFeishu('sent')).toBe('已私信');
  });

  it('mapDmStatusToFeishu: limited → 未送达-仅互关（禁止假 sent）', () => {
    expect(mapDmStatusToFeishu('limited')).toBe('未送达-仅互关');
  });

  it('mapDmStatusToFeishu: failed → 失败', () => {
    expect(mapDmStatusToFeishu('failed')).toBe('失败');
  });

  it('handler: 缺 profile_url 返 status=failed + error', async () => {
    const r: DmOutreachResult = await handleDouyinDmOutreach(
      { profile_url: '', message: 'hi', account_label: '号1' },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
  });

  it('handler: 私信气泡出现 → status=sent（注入 fake page）', async () => {
    const sentText = 'hi-' + Math.floor(performance.now());
    const fakePage = {
      url: () => 'https://www.douyin.com/user/MS4w1',
      goto: async () => undefined,
      // 模拟点私信 + 输入 + 回车后气泡出现
      hasMessageBubble: async (text: string) => text === sentText,
      clickDmButton: async () => true, // 私信按钮可点（非仅互关）
      typeMessage: async () => undefined,
      pressEnter: async () => undefined,
    };
    const r: DmOutreachResult = await handleDouyinDmOutreach(
      { profile_url: 'https://www.douyin.com/user/MS4w1', message: sentText, account_label: '号1' },
      { page: fakePage as never },
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe('sent');
  });

  it('handler: 仅互关（私信按钮不可点）→ status=limited', async () => {
    const fakePage = {
      url: () => 'https://www.douyin.com/user/MS4w2',
      goto: async () => undefined,
      clickDmButton: async () => false, // 仅互关受限：按钮不可点
      hasMessageBubble: async () => false,
      typeMessage: async () => undefined,
      pressEnter: async () => undefined,
    };
    const r: DmOutreachResult = await handleDouyinDmOutreach(
      { profile_url: 'https://www.douyin.com/user/MS4w2', message: 'hi', account_label: '号1' },
      { page: fakePage as never },
    );
    expect(r.status).toBe('limited');
  });
});
