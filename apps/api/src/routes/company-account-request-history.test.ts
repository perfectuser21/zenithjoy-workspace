import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { accountRequestWasUsed } from './company-account-request-history';

describe('公司账号请求历史不能在换机后失忆', () => {
  it('历史查询有匹配即拒绝复用，并参数化传入原请求ID', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const query = vi.fn().mockResolvedValue({ rows: [{ company_id: 'original-company', conflict: { request_id: requestId } }] });
    const client = { query } as unknown as PoolClient;
    await expect(accountRequestWasUsed(client, requestId)).resolves.toBe(true);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([requestId]);
    expect(query.mock.calls[0][0]).not.toContain(requestId);
  });

  it('历史查询成功且无匹配才允许继续新登记', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(accountRequestWasUsed({ query } as unknown as PoolClient, 'unused-request')).resolves.toBe(false);
    expect(query).toHaveBeenCalledOnce();
  });

  it('数据库查询失败必须上抛，不能把历史不可读当成未使用', async () => {
    const failure = new Error('history storage unavailable');
    const query = vi.fn().mockRejectedValue(failure);
    await expect(accountRequestWasUsed({ query } as unknown as PoolClient, 'unknown-request')).rejects.toBe(failure);
    expect(query).toHaveBeenCalledOnce();
  });
});
