import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../db/migrations/20260922_120000_payment_orders.sql'),
  'utf8'
);

describe('payment_orders migration', () => {
  it('订单表带 tenant_id 外键（租户隔离铁律）', () => {
    expect(sql).toMatch(/tenant_id\s+UUID\s+NOT NULL\s+REFERENCES\s+zenithjoy\.tenants/i);
  });

  it('amount_fen 是整数且必须为正（禁浮点）', () => {
    expect(sql).toMatch(/amount_fen\s+INTEGER\s+NOT NULL\s+CHECK\s*\(\s*amount_fen\s*>\s*0\s*\)/i);
  });

  it('(provider, out_trade_no) 唯一 — 幂等第一道闸', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*provider\s*,\s*out_trade_no\s*\)/i);
  });

  it('provider_transaction_id 部分唯一索引 — 防同一笔平台交易入账两次', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*payment_orders\s*\(\s*provider\s*,\s*provider_transaction_id\s*\)[\s\S]*WHERE\s+provider_transaction_id\s+IS NOT NULL/i
    );
  });

  it('credit_transactions.order_id 部分唯一索引 — 入账幂等第二道闸', () => {
    expect(sql).toMatch(/ALTER TABLE\s+zenithjoy\.credit_transactions\s+ADD COLUMN[\s\S]*order_id/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*credit_transactions\s*\(\s*order_id\s*\)[\s\S]*WHERE\s+order_id\s+IS NOT NULL/i
    );
  });

  it('payment_callbacks 用 (provider, provider_transaction_id, event_type) 唯一判首次投递', () => {
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*provider\s*,\s*provider_transaction_id\s*,\s*event_type\s*\)/i
    );
  });

  it('只存回调摘要不存原文（日志红线）', () => {
    expect(sql).toMatch(/raw_digest/i);
    expect(sql).not.toMatch(/raw_body/i);
  });

  it('pending 订单有过期扫描索引', () => {
    expect(sql).toMatch(/CREATE INDEX[\s\S]*payment_orders\s*\(\s*status\s*,\s*expire_at\s*\)[\s\S]*WHERE\s+status\s*=\s*'pending'/i);
  });
});
