import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('axios');

vi.mock('./feishu-token', () => ({
  getValidToken: vi.fn().mockResolvedValue('fake_t_unit'),
}));

import pool from '../db/connection';
import axios from 'axios';
import {
  provisionCustomerListTable,
  syncCustomerList,
  FeishuFetchError,
} from './feishu-customer-list';

const q = () => pool.query as ReturnType<typeof vi.fn>;
const connect = () => pool.connect as ReturnType<typeof vi.fn>;

// 构造一个 fake client（BEGIN/COMMIT/ROLLBACK + query 计数）
function makeClient() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      // 软删 UPDATE 返 rowCount
      if (/UPDATE zenithjoy\.feishu_customer_list/.test(sql) && /is_deleted = true/.test(sql)) {
        return { rowCount: 1 };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

describe('provisionCustomerListTable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('已建过（binding 含 table_id_customer_list）→ 幂等复用，不调飞书建表', async () => {
    q().mockResolvedValueOnce({
      rows: [{ app_token: 'bascn_x', table_id_customer_list: 'tbl_existing' }],
    });
    const r = await provisionCustomerListTable('11111111-1111-1111-1111-111111111111');
    expect(r).toEqual({ app_token: 'bascn_x', table_id: 'tbl_existing', reused: true });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('未建过 → 建 Bitable + 建表 + 写回 binding，reused=false', async () => {
    // loadBinding → 无行
    q().mockResolvedValueOnce({ rows: [] });
    // createBitable → app_token
    (axios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { code: 0, data: { app: { app_token: 'bascn_new' } } } })
      // createTable → table_id
      .mockResolvedValueOnce({ data: { code: 0, data: { table_id: 'tbl_new' } } });
    // 写回 binding upsert
    q().mockResolvedValueOnce({ rows: [] });

    const r = await provisionCustomerListTable('22222222-2222-2222-2222-222222222222');
    expect(r.app_token).toBe('bascn_new');
    expect(r.table_id).toBe('tbl_new');
    expect(r.reused).toBe(false);
  });
});

describe('syncCustomerList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未 provision（无 table_id_customer_list）→ 抛 CUSTOMER_LIST_NOT_PROVISIONED', async () => {
    q().mockResolvedValueOnce({ rows: [{ app_token: 'bascn_x', table_id_customer_list: null }] });
    await expect(syncCustomerList('33333333-3333-3333-3333-333333333333')).rejects.toThrow(
      'CUSTOMER_LIST_NOT_PROVISIONED'
    );
  });

  it('飞书拉取 code!=0 → 抛 FeishuFetchError，且不开事务（本地不动）', async () => {
    q().mockResolvedValueOnce({
      rows: [{ app_token: 'bascn_x', table_id_customer_list: 'tbl_x' }],
    });
    (axios.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { code: 91402, msg: 'not found' },
    });
    await expect(syncCustomerList('44444444-4444-4444-4444-444444444444')).rejects.toBeInstanceOf(
      FeishuFetchError
    );
    expect(connect()).not.toHaveBeenCalled();
  });

  it('飞书 HTTP 抛错 → FeishuFetchError（本地不动）', async () => {
    q().mockResolvedValueOnce({
      rows: [{ app_token: 'bascn_x', table_id_customer_list: 'tbl_x' }],
    });
    (axios.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(syncCustomerList('55555555-5555-5555-5555-555555555555')).rejects.toBeInstanceOf(
      FeishuFetchError
    );
    expect(connect()).not.toHaveBeenCalled();
  });

  it('正常拉到 2 条 → 事务内 upsert 2 行 + COMMIT；返 synced=2', async () => {
    q().mockResolvedValueOnce({
      rows: [{ app_token: 'bascn_x', table_id_customer_list: 'tbl_x' }],
    });
    (axios.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          items: [
            { record_id: 'rec1', fields: { 客户名: '张三', 微信号: 'wxid_zs', 备注: 'vip' } },
            { record_id: 'rec2', fields: { 客户名: '李四', 微信号: 'wxid_ls', 备注: '' } },
          ],
        },
      },
    });
    const { client, calls } = makeClient();
    connect().mockResolvedValueOnce(client);

    const r = await syncCustomerList('66666666-6666-6666-6666-666666666666');
    expect(r.synced).toBe(2);
    // 2 次 upsert INSERT
    const upserts = calls.filter((c) => /INSERT INTO zenithjoy\.feishu_customer_list/.test(c.sql));
    expect(upserts).toHaveLength(2);
    // COMMIT 调用
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(true);
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(false);
  });

  it('mockRecords 覆盖飞书返回（非生产）→ 不调 axios，直接 upsert', async () => {
    q().mockResolvedValueOnce({
      rows: [{ app_token: 'bascn_x', table_id_customer_list: 'tbl_x' }],
    });
    const { client, calls } = makeClient();
    connect().mockResolvedValueOnce(client);

    const r = await syncCustomerList('77777777-7777-7777-7777-777777777777', {
      mockRecords: [{ record_id: 'recA', fields: { 客户名: 'A', 微信号: 'wxA', 备注: '' } }],
    });
    expect(axios.get).not.toHaveBeenCalled();
    expect(r.synced).toBe(1);
    // 软删 UPDATE 也跑了（seen 非空）
    expect(calls.some((c) => /is_deleted = true/.test(c.sql))).toBe(true);
  });
});
