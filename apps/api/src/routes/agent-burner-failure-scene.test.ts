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

// ── AI on-call 横切件 · 刀1：现场第三件（树快照）+ 设备版本三件套 ──────────
//
// 前台包名+诊断行翻过两次错判，但要让 AI 能"指认元素"、让周报能"按机型×版本
// 聚类"，还差：失败那一刻的无障碍树快照 + 设备型号/系统版本/App 版本。
// 机队版本随时间漂移（2.1.32~2.1.35 并存过），不按行落库就没法事后对账。
describe('dm-outreach-result 树快照与设备版本落库（AI on-call 刀1）', () => {
  const SNAPSHOT = 'd0 android.widget.FrameLayout id=- text="-"\nd1 android.widget.Button id=com.ss.android.ugc.aweme:id/msg_btn text="私信" click';

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

  function findLogUpdate() {
    const calls = (pool.query as any).mock.calls as Array<[string, unknown[]?]>;
    return calls.find(([sql]) =>
      /UPDATE\s+zenithjoy\.dm_outreach_log/i.test(sql) && /status\s*=/i.test(sql));
  }

  it('树快照 + 设备版本三件套跟着现场一起写正表', async () => {
    await request(app())
      .post('/api/agent/burner/dm-outreach-result')
      .send({
        task_id: TASK_ID,
        status: 'failed',
        error_code: 'NO_MATCH',
        foreground_pkg: 'com.ss.android.ugc.aweme',
        failure_diag: 'matchProfileByDouyinId 零匹配',
        ui_tree_snapshot: SNAPSHOT,
        device_model: 'HONOR ANY-AN00',
        os_version: 'Android 16 (API 36)',
        app_version: '2.1.36',
        dm_assignment_id: ASSIGNMENT_ID,
      });

    const logUpdate = findLogUpdate();
    expect(logUpdate, '没有找到写 dm_outreach_log 现场的 UPDATE').toBeTruthy();
    const [sql, params] = logUpdate!;
    expect(sql, '正表缺 ui_tree_snapshot——AI 定位求助与周报聚类都没了原材料').toMatch(/ui_tree_snapshot/i);
    expect(sql, '正表缺 device_model').toMatch(/device_model/i);
    expect(sql, '正表缺 os_version').toMatch(/os_version/i);
    expect(sql, '正表缺 app_version').toMatch(/app_version/i);
    expect(params).toEqual(expect.arrayContaining([
      expect.stringContaining('msg_btn'),
      'HONOR ANY-AN00',
      'Android 16 (API 36)',
      '2.1.36',
    ]));
  });

  it('超长树快照服务端二次截断到 64KB——不信任客户端，防撑爆正表', async () => {
    await request(app())
      .post('/api/agent/burner/dm-outreach-result')
      .send({
        task_id: TASK_ID,
        status: 'failed',
        error_code: 'NO_MATCH',
        foreground_pkg: 'p',
        failure_diag: 'd',
        ui_tree_snapshot: 'x'.repeat(80_000),
        dm_assignment_id: ASSIGNMENT_ID,
      });

    const [, params] = findLogUpdate()!;
    const stored = (params as unknown[]).find(
      (p) => typeof p === 'string' && (p as string).startsWith('xxx'),
    ) as string;
    expect(stored, '快照参数未入库').toBeTruthy();
    expect(stored.length, '服务端必须把快照截断到 65536 字符').toBeLessThanOrEqual(65536);
  });

  it('每次写入顺手清扫 30 天前的旧快照——保留期闸（主理人拍板 30 天）', async () => {
    await request(app())
      .post('/api/agent/burner/dm-outreach-result')
      .send({
        task_id: TASK_ID,
        status: 'failed',
        error_code: 'NO_MATCH',
        foreground_pkg: 'p',
        failure_diag: 'd',
        ui_tree_snapshot: SNAPSHOT,
        dm_assignment_id: ASSIGNMENT_ID,
      });

    const calls = (pool.query as any).mock.calls as Array<[string, unknown[]?]>;
    const sweep = calls.find(([sql]) =>
      /UPDATE\s+zenithjoy\.dm_outreach_log/i.test(sql) &&
      /ui_tree_snapshot\s*=\s*NULL/i.test(sql) &&
      /30 days/i.test(sql));
    expect(sweep, '缺 30 天保留期清扫——重列会无限膨胀（只清快照，其余现场字段永久保留）').toBeTruthy();
  });
});
