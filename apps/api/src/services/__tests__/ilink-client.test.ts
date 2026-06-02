/* eslint-disable @typescript-eslint/no-explicit-any -- 动态 import 后鸭子类型断言，测试容忍 any */
import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-client（对齐腾讯官方 openclaw-weixin 真实协议）
 *
 * 真实协议要点（来自 Tencent/openclaw-weixin src/api/types.ts + api.ts）：
 *   - getupdates 响应 = { ret, errcode?, msgs: WeixinMessage[], get_updates_buf }
 *   - WeixinMessage = { from_user_id, to_user_id, message_type(1=USER/2=BOT),
 *                       item_list:[{ type(1=TEXT), text_item:{ text } }], context_token }
 *   - sendmessage body = { msg: WeixinMessage }，text item = { type:1, text_item:{ text } }
 *   - errcode=-14 = 会话超时
 */

describe('ilink-client [BEHAVIOR]', () => {
  it('parseUpdates 从 msgs 抽出 USER 文字私聊（from_user_id / text / context_token）', async () => {
    const mod = await import('../ilink-client');
    expect(typeof (mod as any).parseUpdates).toBe('function');

    const resp = {
      ret: 0,
      msgs: [
        {
          from_user_id: 'wx_external_A',
          to_user_id: 'wx_burner_self',
          message_type: 1, // USER
          item_list: [{ type: 1, text_item: { text: '你好，问下价格' } }],
          context_token: 'ctx-abc-123',
        },
      ],
      get_updates_buf: 'cursor-2',
    };
    const parsed = (mod as any).parseUpdates(resp);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from_user_id).toBe('wx_external_A');
    expect(parsed[0].text).toBe('你好，问下价格');
    expect(parsed[0].context_token).toBe('ctx-abc-123');
  });

  it('parseUpdates 过滤 BOT 自己的消息 + 非文字 item（媒体/空）', async () => {
    const mod = await import('../ilink-client');
    const parsed = (mod as any).parseUpdates({
      ret: 0,
      msgs: [
        // BOT 自己发的（message_type=2）→ 跳过
        { from_user_id: 'self', message_type: 2, item_list: [{ type: 1, text_item: { text: 'AI 之前回的' } }], context_token: 'bot' },
        // USER 但只有图片 item（type=2）→ 跳过
        { from_user_id: 'wxImg', message_type: 1, item_list: [{ type: 2, image_item: {} }], context_token: 'img' },
        // USER 文字 → 保留
        { from_user_id: 'wxB', message_type: 1, item_list: [{ type: 1, text_item: { text: '真私聊' } }], context_token: 'real' },
      ],
      get_updates_buf: 'c',
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('真私聊');
    expect(parsed[0].from_user_id).toBe('wxB');
  });

  it('buildSendMessageBody 构造 WeixinMessage：item_list[0]=text item（type=1 + text_item.text）', async () => {
    const mod = await import('../ilink-client');
    expect(typeof (mod as any).buildSendMessageBody).toBe('function');

    const msg = (mod as any).buildSendMessageBody({
      to_user_id: 'wx_external_A',
      context_token: 'ctx-abc-123',
      text: 'AI 回复一句话',
    });
    expect(msg.to_user_id).toBe('wx_external_A');
    expect(msg.context_token).toBe('ctx-abc-123');
    expect(msg.item_list).toHaveLength(1);
    expect(msg.item_list[0].type).toBe(1);
    expect(msg.item_list[0].text_item.text).toBe('AI 回复一句话');
  });

  it('isSessionTimeoutError 识别 errcode=-14', async () => {
    const mod = await import('../ilink-client');
    expect((mod as any).isSessionTimeoutError({ errcode: -14, errmsg: 'session timeout' })).toBe(true);
    expect((mod as any).isSessionTimeoutError({ ret: 0, msgs: [] })).toBe(false);
    expect((mod as any).isSessionTimeoutError({ errcode: -1 })).toBe(false);
  });

  it('暴露真实端点常量（bot_type=3）+ 登录/收发函数齐备', async () => {
    const mod = await import('../ilink-client');
    // DEFAULT_ILINK_BOT_TYPE 对齐官方 channel build = "3"
    expect((mod as any).DEFAULT_ILINK_BOT_TYPE).toBe('3');
    expect(typeof (mod as any).getBotQrcode).toBe('function');
    expect(typeof (mod as any).pollQrStatus).toBe('function');
    expect(typeof (mod as any).getupdates).toBe('function');
    expect(typeof (mod as any).sendmessage).toBe('function');
  });
});
