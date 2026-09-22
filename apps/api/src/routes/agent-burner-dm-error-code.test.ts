/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 私信失败原因必须落进 dm_outreach_log —— NO_SEARCH_INPUT 反复复发四次的元凶。
 *
 * 现状（0821 实测）：手机把 error_code 上报上来了，服务端也收到了，但写
 * dm_outreach_log（"私信成没成"的正表、看板读的就是它）的那条 UPDATE 只写 status：
 *
 *     UPDATE zenithjoy.dm_outreach_log SET status=$2 WHERE assignment_id=$1
 *
 * 原因被丢在旁边 publish_tasks.response 这个 JSONB 里，没人会去翻。于是看板上
 * 永远只有 "failed" 三个字，看不到"因为等输入框时前台被抢走了"。
 * 0821 我是硬翻 JSON 才挖出连续 6 次全是同一个 NO_SEARCH_INPUT——
 * 正常没人这么干，所以这个 bug 才能"修好又复发"四次没被抓住。
 *
 * 这条断言就是守卫本体：把 error_code 从那条 UPDATE 里拿掉，本测试必须报红。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => next(),
  tenantContextOptional: (req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/agent-context', () => ({
  agentContext: (req: any, _res: any, next: any) => next(),
}));

import pool from '../db/connection';
import router from './agent-burner';

const ASSIGNMENT_ID = 'a1111111-1111-4111-8111-111111111111';
const TASK_ID = 'c9af7c3c-64c5-4c1b-be56-75880dce0288';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/agent/burner', router);
  return a;
}

describe('dm-outreach-result 失败原因落库', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/SELECT/i.test(sql)) {
        return {
          rows: [{
            id: TASK_ID,
            status: 'dispatched',
            payload: { assignment_id: ASSIGNMENT_ID, tenant_id: 't1', account_label: '嘻嘻' },
            response: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it('写 dm_outreach_log 的 UPDATE 必须带上 error_code，而不是只写 status', async () => {
    await request(app())
      .post('/api/agent/burner/dm-outreach-result')
      .send({
        task_id: TASK_ID,
        status: 'failed',
        error_code: 'NO_SEARCH_INPUT',
        dm_assignment_id: ASSIGNMENT_ID,
      });

    const calls = (pool.query as any).mock.calls as Array<[string, unknown[]?]>;
    const logUpdate = calls.find(([sql]) => /UPDATE\s+zenithjoy\.dm_outreach_log/i.test(sql));
    expect(logUpdate, '没有找到写 dm_outreach_log 的 UPDATE').toBeTruthy();

    const [sql, params] = logUpdate!;
    expect(sql, 'dm_outreach_log 的 UPDATE 里没有 error_code —— 失败原因又被丢了').toMatch(/error_code/i);
    expect(params, 'error_code 没有作为参数传进去').toEqual(
      expect.arrayContaining(['NO_SEARCH_INPUT']),
    );
  });
});
