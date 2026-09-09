/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * content-publish-dispatch 服务层直调契约。
 *
 * route（routes/publish-dispatch.ts）与 notion-orchestrator 两条调用路径已分别
 * 覆盖到 HTTP/编排台外壳，这份补服务函数本身的直调面：校验顺序、CAS 竞态、
 * payload 组装、以及跨模块共用的 NON_TERMINAL_TASK_STATUSES 常量契约。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../walking-skeleton.service', () => ({ findActiveAgentByTenantId: vi.fn() }));

import pool from '../../db/connection';
import { findActiveAgentByTenantId } from '../walking-skeleton.service';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
  DispatchValidationError,
  NON_TERMINAL_TASK_STATUSES,
} from '../content-publish-dispatch';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AGENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const CONTENT_ROW = {
  id: CID, title: '今日份的治愈色', body: '生活需要一点渐变 #治愈', type: 'image',
  platforms: ['douyin', 'xiaohongshu'], status: 'draft',
};
const MATERIAL_ROWS = [
  { id: 'm1', storage_key: 'k/a.jpg', file_name: 'a.jpg', mime_type: 'image/jpeg' },
];

/** 查询桩：查 content 返回指定行，查素材返回指定素材集。 */
function stubQueries(contentRow: any = CONTENT_ROW, materialRows: any[] = MATERIAL_ROWS) {
  (pool.query as any).mockImplementation(async (sql: string) => {
    if (/FROM zenithjoy\.contents/i.test(sql)) return { rows: contentRow ? [contentRow] : [] };
    if (/FROM zenithjoy\.content_materials/i.test(sql)) return { rows: materialRows };
    return { rows: [] };
  });
}

/** 假事务 client：记录事务内所有 SQL 供断言。CAS 默认成功（rowCount=1）。 */
function stubTx(casResult: { rows: any[]; rowCount: number } = { rows: [{ id: CID }], rowCount: 1 }) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  let n = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params: params ?? [] });
      if (/UPDATE zenithjoy\.contents/i.test(sql)) return casResult;
      if (/INSERT INTO zenithjoy\.publish_tasks/i.test(sql)) return { rows: [{ id: `task-${++n}` }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  (pool.connect as any).mockResolvedValue(client);
  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  (findActiveAgentByTenantId as any).mockResolvedValue({ id: AGENT_ID, tenant_id: TENANT });
  stubQueries();
  stubTx();
});

describe('dispatchContentPublish', () => {
  it('① 作品不存在（或跨租户）→ 返回 null', async () => {
    stubQueries(null);
    const r = await dispatchContentPublish({ contentId: CID, tenantId: TENANT });
    expect(r).toBeNull();
  });

  it('② platforms 空（作品无 platforms 且未覆盖）→ DispatchValidationError(INVALID_PLATFORMS)', async () => {
    stubQueries({ ...CONTENT_ROW, platforms: [] });
    await expect(dispatchContentPublish({ contentId: CID, tenantId: TENANT }))
      .rejects.toBeInstanceOf(DispatchValidationError);
    try {
      await dispatchContentPublish({ contentId: CID, tenantId: TENANT });
      throw new Error('应抛出但没有抛出');
    } catch (err) {
      expect((err as DispatchValidationError).code).toBe('INVALID_PLATFORMS');
    }
  });

  it('③ 平台不在白名单 → DispatchValidationError(INVALID_PLATFORMS)', async () => {
    try {
      await dispatchContentPublish({
        contentId: CID, tenantId: TENANT, platformsOverride: ['douyin', 'myspace'],
      });
      throw new Error('应抛出但没有抛出');
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchValidationError);
      expect((err as DispatchValidationError).code).toBe('INVALID_PLATFORMS');
    }
  });

  it('④ 作品 type 非法 → DispatchValidationError(INVALID_CONTENT_TYPE)', async () => {
    stubQueries({ ...CONTENT_ROW, type: 'ppt' });
    try {
      await dispatchContentPublish({ contentId: CID, tenantId: TENANT });
      throw new Error('应抛出但没有抛出');
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchValidationError);
      expect((err as DispatchValidationError).code).toBe('INVALID_CONTENT_TYPE');
    }
  });

  it('⑤ 作品已 queued（事务外礼貌拦截）→ AlreadyQueuedError，且不建事务', async () => {
    stubQueries({ ...CONTENT_ROW, status: 'queued' });
    await expect(dispatchContentPublish({ contentId: CID, tenantId: TENANT }))
      .rejects.toBeInstanceOf(AlreadyQueuedError);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('⑥ 租户无活跃 agent → NoActiveAgentError', async () => {
    (findActiveAgentByTenantId as any).mockResolvedValue(null);
    await expect(dispatchContentPublish({ contentId: CID, tenantId: TENANT }))
      .rejects.toBeInstanceOf(NoActiveAgentError);
  });

  it('⑦ 并发对手抢先：CAS rowCount=0 → ROLLBACK 且 AlreadyQueuedError，无 INSERT', async () => {
    const { calls } = stubTx({ rows: [], rowCount: 0 });
    await expect(dispatchContentPublish({ contentId: CID, tenantId: TENANT }))
      .rejects.toBeInstanceOf(AlreadyQueuedError);
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(true);
    expect(calls.filter((c) => /INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql))).toHaveLength(0);
  });

  it('⑧ 成功：每平台一条 INSERT，payload 字段齐，重复平台自动去重', async () => {
    const { calls } = stubTx();
    const r = await dispatchContentPublish({
      contentId: CID, tenantId: TENANT, platformsOverride: ['douyin', 'douyin', 'weibo'],
    });
    expect(r).toEqual({
      content_id: CID,
      tasks: [{ id: 'task-1', platform: 'douyin' }, { id: 'task-2', platform: 'weibo' }],
    });

    const inserts = calls.filter((c) => /INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql));
    expect(inserts).toHaveLength(2);
    const payload = JSON.parse(inserts[0].params[inserts[0].params.length - 1]);
    expect(payload).toMatchObject({
      content_id: CID, title: CONTENT_ROW.title, body: CONTENT_ROW.body,
      content_type: 'image', platform: 'douyin',
    });
    expect(payload.materials).toHaveLength(1);
    expect(payload.materials[0]).toMatchObject(MATERIAL_ROWS[0]);
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(true);
  });

  it('⑨ NON_TERMINAL_TASK_STATUSES 导出且含 pending/queued/dispatched/in_progress/running 五值', () => {
    expect(NON_TERMINAL_TASK_STATUSES).toHaveLength(5);
    expect(NON_TERMINAL_TASK_STATUSES).toEqual(
      expect.arrayContaining(['pending', 'queued', 'dispatched', 'in_progress', 'running']),
    );
  });
});
