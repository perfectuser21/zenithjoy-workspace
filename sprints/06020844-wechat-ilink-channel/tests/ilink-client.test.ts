import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-client TDD Red
 *
 * 第一刀目标：从 openclaw-weixin 移植 iLink HTTP JSON 协议到 apps/api 自有 client。
 * 这些 import 在 Generator 实现前必须 FAIL（模块/导出不存在）。
 */

describe('ilink-client [BEHAVIOR]', () => {
  it('getupdates 解析返回的 update 列表（私聊文字 → from_user_id / text / context_token）', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-client');
    expect(typeof (mod as any).getupdates).toBe('function');

    const fakeUpdates = {
      updates: [
        {
          type: 'text',
          scene: 'single',
          from_user_id: 'wx_external_A',
          to_user_id: 'wx_burner_self',
          text: '你好，问下价格',
          context_token: 'ctx-abc-123',
          received_at: '2026-06-02T08:30:00Z',
        },
      ],
      get_updates_buf: 'cursor-2',
    };
    const parsed = (mod as any).parseUpdates(fakeUpdates);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from_user_id).toBe('wx_external_A');
    expect(parsed[0].text).toBe('你好，问下价格');
    expect(parsed[0].context_token).toBe('ctx-abc-123');
  });

  it('sendmessage 构造请求体含 to_user_id / context_token / item_list (1 元素 text)', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-client');
    expect(typeof (mod as any).buildSendMessageBody).toBe('function');

    const body = (mod as any).buildSendMessageBody({
      to_user_id: 'wx_external_A',
      context_token: 'ctx-abc-123',
      text: 'AI 回复一句话',
    });
    expect(body.to_user_id).toBe('wx_external_A');
    expect(body.context_token).toBe('ctx-abc-123');
    expect(body.item_list).toHaveLength(1);
    expect(body.item_list[0].type).toBe('text');
    expect(body.item_list[0].text).toBe('AI 回复一句话');
  });

  it('errcode=-14 (session timeout) 被识别为 SessionTimeoutError', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-client');
    expect(typeof (mod as any).isSessionTimeoutError).toBe('function');

    expect((mod as any).isSessionTimeoutError({ errcode: -14, errmsg: 'session timeout' })).toBe(true);
    expect((mod as any).isSessionTimeoutError({ errcode: -1, errmsg: 'unknown' })).toBe(false);
    expect((mod as any).isSessionTimeoutError({ errcode: 0 })).toBe(false);
  });

  it('非私聊文字消息（群聊 / 媒体 / 系统通知）被过滤掉', async () => {
    const mod = await import('../../../apps/api/src/services/ilink-client');
    const parsed = (mod as any).parseUpdates({
      updates: [
        { type: 'text', scene: 'group', from_user_id: 'g1', text: '群聊消息', context_token: 'g' },
        { type: 'image', scene: 'single', from_user_id: 'wxA', context_token: 'img' },
        { type: 'sys', scene: 'single', from_user_id: 'wxA', context_token: 'sys' },
        { type: 'text', scene: 'single', from_user_id: 'wxB', text: '真私聊', context_token: 'real' },
      ],
      get_updates_buf: 'c',
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('真私聊');
  });
});
