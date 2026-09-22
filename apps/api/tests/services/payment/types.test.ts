import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  RECHARGE_TIERS,
  SignatureError,
} from '../../../src/services/payment/types';

describe('订单状态机', () => {
  it('credited 只能从 pending 来 —— 防止 created 直接跳到已入账', () => {
    expect(ALLOWED_TRANSITIONS.credited).toEqual(['pending']);
  });

  it('pending 只能从 created 来', () => {
    expect(ALLOWED_TRANSITIONS.pending).toEqual(['created']);
  });

  it('expired 只能从 pending 来 —— 已入账的单不可被标过期', () => {
    expect(ALLOWED_TRANSITIONS.expired).toEqual(['pending']);
  });

  it('refund_pending 只能从 credited 来 —— 没入过账的单不存在退款', () => {
    expect(ALLOWED_TRANSITIONS.refund_pending).toEqual(['credited']);
  });

  it('终态没有任何合法前置（不可被再次转入）', () => {
    expect(ALLOWED_TRANSITIONS.created).toEqual([]);
  });

  it('整张转移表逐条锁死（任一条被改坏或新增状态漏定义都会红）', () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      created: [],
      pending: ['created'],
      credited: ['pending'],
      create_failed: ['created'],
      expired: ['pending'],
      amount_mismatch: ['pending'],
      refund_pending: ['credited'],
    });
  });
});

describe('充值档位', () => {
  it('档位金额与积分均为正整数（分，禁浮点）', () => {
    expect(RECHARGE_TIERS.length).toBeGreaterThan(0);
    for (const t of RECHARGE_TIERS) {
      expect(Number.isInteger(t.amountFen)).toBe(true);
      expect(t.amountFen).toBeGreaterThan(0);
      expect(Number.isInteger(t.credits)).toBe(true);
      expect(t.credits).toBeGreaterThan(0);
    }
  });

  it('档位 id 唯一', () => {
    const ids = RECHARGE_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SignatureError', () => {
  it('是 Error 子类且可被 instanceof 判别', () => {
    const e = new SignatureError('bad sign');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SignatureError);
    expect(e.message).toBe('bad sign');
  });
});
