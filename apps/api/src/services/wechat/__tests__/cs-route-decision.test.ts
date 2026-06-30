import { describe, it, expect } from 'vitest';
import {
  decideReplyRoute,
  decideAutoSendRoute,
  withinBusinessHours,
  ROUTE_AUTO,
  ROUTE_REVIEW,
  ROUTE_PENDING_HUMAN,
  ROUTE_SKIP_OFFHOURS,
  ROUTE_SEND,
  ROUTE_SKIP_GROUP,
  ROUTE_SKIP_BLACKLISTED,
} from '../cs-route-decision';

/**
 * cs-route-decision.ts 单测 —— TS 侧路由真值表，与 auto_reply.py 决策核心 1:1 镜像。
 * 这是「服务端为主」接线的决策核心：generateChatDraft(mode:auto) 直接调它分流。
 */

describe('decideReplyRoute 真值表（镜像 auto_reply.decide_reply_route）', () => {
  it('auto_agent_on=false → review（监控态，优先级最高）', () => {
    expect(decideReplyRoute(true, true, false, 0, 0)).toBe(ROUTE_REVIEW);
    expect(decideReplyRoute(false, false, false, 99, 1)).toBe(ROUTE_REVIEW);
  });

  it('ON + 名单外 → pending_human', () => {
    expect(decideReplyRoute(false, true, true, 0, 0)).toBe(ROUTE_PENDING_HUMAN);
  });

  it('ON + 名单内 + 营业时间外 → skip_offhours', () => {
    expect(decideReplyRoute(true, false, true, 0, 0)).toBe(ROUTE_SKIP_OFFHOURS);
  });

  it('ON + 名单内 + 营业时间内 + 超 daily_limit → pending_human', () => {
    expect(decideReplyRoute(true, true, true, 2, 2)).toBe(ROUTE_PENDING_HUMAN);
    expect(decideReplyRoute(true, true, true, 3, 2)).toBe(ROUTE_PENDING_HUMAN);
  });

  it('ON + 名单内 + 营业时间内 + 未超额 → auto；daily_limit=0 不限', () => {
    expect(decideReplyRoute(true, true, true, 0, 0)).toBe(ROUTE_AUTO);
    expect(decideReplyRoute(true, true, true, 99, 0)).toBe(ROUTE_AUTO);
    expect(decideReplyRoute(true, true, true, 1, 2)).toBe(ROUTE_AUTO);
  });

  it('route 取值 ⊆ 4 字面量，不出现禁用同义词', () => {
    const banned = new Set([
      'auto_reply', 'autosend', 'skip', 'pending', 'blocked', 'limited', 'off_hours',
    ]);
    const allowed = new Set([ROUTE_AUTO, ROUTE_REVIEW, ROUTE_PENDING_HUMAN, ROUTE_SKIP_OFFHOURS]);
    for (const a of [true, false]) {
      for (const b of [true, false]) {
        for (const c of [true, false]) {
          const r = decideReplyRoute(a, b, c, 0, 0);
          expect(allowed.has(r)).toBe(true);
          expect(banned.has(r)).toBe(false);
        }
      }
    }
  });
});

describe('decideAutoSendRoute 去飞书自动直发 gating（blacklist 主模型，默认全回）', () => {
  it('个人 + 未标黑 → send（默认全回，自动直发）', () => {
    expect(decideAutoSendRoute(false, false)).toBe(ROUTE_SEND);
  });

  it('个人 + 标黑 → skip_blacklisted（黑名单不回）', () => {
    expect(decideAutoSendRoute(false, true)).toBe(ROUTE_SKIP_BLACKLISTED);
  });

  it('群消息 → skip_group（绝不回群，群优先于黑名单判定）', () => {
    expect(decideAutoSendRoute(true, false)).toBe(ROUTE_SKIP_GROUP);
    expect(decideAutoSendRoute(true, true)).toBe(ROUTE_SKIP_GROUP);
  });

  it('返回值 ⊆ 3 字面量', () => {
    const allowed = new Set([ROUTE_SEND, ROUTE_SKIP_GROUP, ROUTE_SKIP_BLACKLISTED]);
    for (const g of [true, false]) {
      for (const b of [true, false]) {
        expect(allowed.has(decideAutoSendRoute(g, b))).toBe(true);
      }
    }
  });
});

describe('withinBusinessHours（镜像 auto_reply.within_business_hours，含跨午夜）', () => {
  it('06:00–24:00 全天为真', () => {
    expect(withinBusinessHours('06:00', '24:00', 6 * 60)).toBe(true);
    expect(withinBusinessHours('06:00', '24:00', 23 * 60 + 59)).toBe(true);
    expect(withinBusinessHours('06:00', '24:00', 5 * 60 + 59)).toBe(false);
  });

  it('普通区间 09:00–10:00 闭开 [start,end)', () => {
    expect(withinBusinessHours('09:00', '10:00', 9 * 60)).toBe(true);
    expect(withinBusinessHours('09:00', '10:00', 9 * 60 + 59)).toBe(true);
    expect(withinBusinessHours('09:00', '10:00', 10 * 60)).toBe(false);
    expect(withinBusinessHours('09:00', '10:00', 23 * 60 + 30)).toBe(false);
  });

  it('跨午夜 22:00–02:00：23:30 真 / 03:00 假', () => {
    expect(withinBusinessHours('22:00', '02:00', 23 * 60 + 30)).toBe(true);
    expect(withinBusinessHours('22:00', '02:00', 1 * 60)).toBe(true);
    expect(withinBusinessHours('22:00', '02:00', 3 * 60)).toBe(false);
  });

  it('非法时间格式 → 抛错（调用方兜，不崩主链路）', () => {
    expect(() => withinBusinessHours('bad', '24:00', 60)).toThrow();
    expect(() => withinBusinessHours('06:00', '24:30', 60)).toThrow();
  });
});
