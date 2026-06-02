import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-types 协议常量 TDD Red
 *
 * 验证 ilink-types.ts 将协议魔法数字和固定字符串封装为命名常量导出。
 * Generator 实现前必须 FAIL（模块/常量不存在）。
 */

describe('ilink-types 协议常量 [ARTIFACT]', () => {
  it('ILINK_SESSION_TIMEOUT_CODE === -14（协议 errcode 魔法数字锁定为命名常量）', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-types');
    expect((mod as any).ILINK_SESSION_TIMEOUT_CODE).toBe(-14);
  });

  it('ILINK_BOT_AUTH_TYPE === "ilink_bot_token"（请求头 AuthorizationType 固定值）', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-types');
    expect((mod as any).ILINK_BOT_AUTH_TYPE).toBe('ilink_bot_token');
  });

  it('isSingleChatTextUpdate 工具函数：正确分类私聊文字 vs 其他消息', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-types');
    expect(typeof (mod as any).isSingleChatTextUpdate).toBe('function');

    const single_text = { type: 'text', scene: 'single', from_user_id: 'wxA', text: 'hi', context_token: 'c1' };
    const group_text  = { type: 'text', scene: 'group',  from_user_id: 'wxB', text: 'hi', context_token: 'c2' };
    const single_img  = { type: 'image', scene: 'single', from_user_id: 'wxC', context_token: 'c3' };

    expect((mod as any).isSingleChatTextUpdate(single_text)).toBe(true);
    expect((mod as any).isSingleChatTextUpdate(group_text)).toBe(false);
    expect((mod as any).isSingleChatTextUpdate(single_img)).toBe(false);
  });
});
