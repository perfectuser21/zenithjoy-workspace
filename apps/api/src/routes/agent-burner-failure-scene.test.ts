/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RPA 失败现场必须落进人会看的正表（invariant 93ed0761）。
 *
 * PR#1687 已经把 error_code 接进 dm_outreach_log，但"为什么会有这个错误码"
 * 还是看不见——0821 真正定位靠的是 agent 日志里的 fgPkg 和那条诊断行，
 * 而它们至今只存在于 logcat，重启就没了。本测试钉住：这两件也要落正表。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (_req: any, _res: any, next: any) => next(),
  tenantContextOptional: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middleware/agent-context', () => ({
  agentContext: (_req: any, _res: any, next: any) => next(),
}));

import pool from '../db/connection';
import router from './agent-burner';

const ASSIGNMENT_ID = 'b2222222-2222-4222-8222-222222222222';
const TASK_ID = 'd1e2f3a4-5b6c-4d7e-8f90-1a2b3c4d5e6f';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/agent/burner', router);
  return a;
}

describe('dm-outreach-result 失败现场落库', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/SELECT/i.test(sql)) {
        return {
          rows: [{ id: TASK_ID, status: 'dispatched',
            payload: { assignment_id: ASSIGNMENT_ID, tenant_id: 't1', account_label: '嘻嘻' },
            response: null }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it('前台包名与诊断行必须跟着 error_code 一起写进 dm_outreach_log', async () => {
    await request(app())
      .post('/api/agent/burner/dm-outreach-result')
      .send({
        task_id: TASK_ID,
        status: 'failed',
        error_code: 'NO_SEARCH_INPUT',
        foreground_pkg: 'com.hihonor.systemmanager',
        failure_diag: 'searchBtnFound=true failure=WRONG_FOREGROUND attempts=12',
        dm_assignment_id: ASSIGNMENT_ID,
      });

    const calls = (pool.query as any).mock.calls as Array<[string, unknown[]?]>;
    const logUpdate = calls.find(([sql]) => /UPDATE\s+zenithjoy\.dm_outreach_log/i.test(sql));
    expect(logUpdate, '没有找到写 dm_outreach_log 的 UPDATE').toBeTruthy();

    const [sql, params] = logUpdate!;
    expect(sql, '正表 UPDATE 里没有 foreground_pkg——排查又要回去翻 logcat').toMatch(/foreground_pkg/i);
    expect(sql, '正表 UPDATE 里没有 failure_diag').toMatch(/failure_diag/i);
    expect(params).toEqual(expect.arrayContaining(['com.hihonor.systemmanager']));
    expect(params).toEqual(
      expect.arrayContaining([expect.stringContaining('WRONG_FOREGROUND')]),
    );
  });
});
