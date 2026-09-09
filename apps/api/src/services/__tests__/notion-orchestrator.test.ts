/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 编排台同步器契约：三方向（推行/拉发/回执）+ 启动自检。
 * 真相在 DB，Notion 只是视图——所以锚失效跳过不猜、白名单不信 Notion 手加 option、
 * 回执写完必须把 contents 挪出 queued（否则每 60s 重写 + 作品永锁）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../notion-client', () => ({ notionRequest: vi.fn() }));
vi.mock('../content-publish-dispatch', async () => {
  const actual = await vi.importActual<any>('../content-publish-dispatch');
  return {
    ...actual, // 保留错误类（worker 要 instanceof）与 PUBLISH_PLATFORMS
    dispatchContentPublish: vi.fn(),
  };
});

import pool from '../../db/connection';
import { notionRequest } from '../notion-client';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
} from '../content-publish-dispatch';
import { InMemoryMaterialStorage } from '../material-storage';
import { runOnce, startNotionOrchestrator } from '../notion-orchestrator';

const TENANT = 'b0058fb7-645d-4d2b-ab25-8d9d4a764b29';
const CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ENV = { dbId: 'db-1', tenantId: TENANT };
const deps = () => ({ storage: new InMemoryMaterialStorage() });

/** page 对象构造器：拉发方向 query 返回的行 */
function notionRow(over: any = {}) {
  return {
    id: 'page-1',
    properties: {
      '标题': { title: [{ plain_text: '新标题' }] },
      '文案': { rich_text: [{ plain_text: '新文案' }] },
      '平台': { multi_select: [{ name: 'douyin' }, { name: 'weibo' }] },
      'content_id': { rich_text: [{ plain_text: CID }] },
      ...over,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (pool.query as any).mockResolvedValue({ rows: [] });
  (notionRequest as any).mockImplementation(async (_m: string, path: string) => {
    if (path.includes('/query')) return { results: [], has_more: false };
    return { id: 'page-new' };
  });
});

describe('启动自检', () => {
  it('缺 env → 红日志 + 返回 null 不启动', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.NOTION_INTEGRATION_TOKEN;
    delete process.env.NOTION_PUBLISH_ORCH_DB_ID;
    const t = startNotionOrchestrator();
    expect(t).toBeNull();
    expect(spy.mock.calls.flat().join(' ')).toContain('[notion-orch]');
    spy.mockRestore();
  });
});

describe('方向A 推行（作品→Notion）', () => {
  it('draft 且 notion_page_id 为空的作品 → 建行并回写 page id', async () => {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql) && /notion_page_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID, title: '治愈色', body: '文案', type: 'image', platforms: ['douyin'] }] };
      }
      if (/FROM zenithjoy\.content_materials/i.test(sql)) {
        return { rows: [{ file_name: 'a.jpg', storage_key: 'k/a.jpg' }] };
      }
      return { rows: [] };
    });
    await runOnce(ENV, deps());
    const createCall = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages');
    expect(createCall).toBeTruthy();
    const props = createCall[2].properties;
    expect(props['标题'].title[0].text.content).toBe('治愈色');
    expect(props['状态'].select.name).toBe('草稿');
    expect(props['content_id'].rich_text[0].text.content).toBe(CID);
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET notion_page_id/i.test(c[0]));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain(CID);
  });
});

describe('方向B 拉发（状态=发）', () => {
  function stubFireRow(row: any) {
    (notionRequest as any).mockImplementation(async (_m: string, path: string) => {
      if (path.includes('/query')) return { results: [row], has_more: false };
      return { id: 'x' };
    });
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql)) return { rows: [{ id: CID }] };
      return { rows: [] };
    });
  }

  it('合法行 → 回写标题文案平台 + dispatch + 行置排队中', async () => {
    stubFireRow(notionRow());
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }, { id: 't2', platform: 'weibo' }] });
    await runOnce(ENV, deps());
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]));
    expect(upd).toBeTruthy();
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: CID, tenantId: TENANT, platformsOverride: ['douyin', 'weibo'] }),
    );
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('排队中');
  });

  it('Notion 手加的非法平台被白名单过滤，不进 dispatch', async () => {
    stubFireRow(notionRow({ '平台': { multi_select: [{ name: 'douyin' }, { name: 'myspace' }] } }));
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ platformsOverride: ['douyin'] }),
    );
  });

  it('content_id 非 UUID → 锚失效：行置派发失败，dispatch 不被调', async () => {
    stubFireRow(notionRow({ 'content_id': { rich_text: [{ plain_text: 'not-a-uuid' }] } }));
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).not.toHaveBeenCalled();
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('派发失败');
  });

  it('AlreadyQueued → 幂等成功：行置排队中', async () => {
    stubFireRow(notionRow());
    (dispatchContentPublish as any).mockRejectedValue(new AlreadyQueuedError());
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('排队中');
  });

  it('NoActiveAgent → 行置派发失败且回执含人话原因', async () => {
    stubFireRow(notionRow());
    (dispatchContentPublish as any).mockRejectedValue(new NoActiveAgentError());
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('派发失败');
    expect(patch[2].properties['回执'].rich_text[0].text.content).toContain('agent');
  });
});

describe('方向C 回执（任务终态→Notion）', () => {
  function stubQueuedContent(taskRows: any[]) {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/status = 'queued'/i.test(sql) && /notion_page_id IS NOT NULL/i.test(sql)) {
        return { rows: [{ id: CID, notion_page_id: 'page-1' }] };
      }
      if (/FROM zenithjoy\.publish_tasks/i.test(sql)) return { rows: taskRows };
      return { rows: [] };
    });
  }

  it('全部 done → 行状态已发 + contents 置 published', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'done', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('已发');
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'published'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('有 failed → 部分失败 + contents 置 failed；回执截断 ≤1900', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'failed', result: { error: 'x'.repeat(3000) } },
    ]);
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch[2].properties['状态'].select.name).toBe('部分失败');
    expect(patch[2].properties['回执'].rich_text[0].text.content.length).toBeLessThanOrEqual(1900);
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'failed'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('还有任务未终态 → 不写回执不改状态', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'dispatched', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (notionRequest as any).mock.calls.find((c: any[]) => c[1] === '/pages/page-1');
    expect(patch).toBeFalsy();
  });
});
