/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 飞书发布编排台同步器契约（刀5b Task 3）：三方向（推行/拉发/回执）+ 启动自检 +
 * 租户互斥 + 频控跳轮。镜像 notion-orchestrator.test.ts 的整体结构与断言粒度；
 * 净增覆盖：Bitable 值形态合同（写=多选字符串数组/单选裸字符串/URL={text,link}/
 * 文本裸字符串；读=文本 segment 数组与裸字符串两形态兼容）、与 Notion 编排台的
 * 租户互斥单边拒启、飞书频控错误(FeishuRateLimitError)跳过本轮不崩。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../feishu-client', async () => {
  const actual = await vi.importActual<any>('../feishu-client');
  return {
    ...actual, // 保留 FeishuRateLimitError 真实类（worker 要 instanceof）
    feishuRequest: vi.fn(),
  };
});
vi.mock('../content-publish-dispatch', async () => {
  const actual = await vi.importActual<any>('../content-publish-dispatch');
  return {
    ...actual, // 保留错误类（worker 要 instanceof）与 PUBLISH_PLATFORMS
    dispatchContentPublish: vi.fn(),
  };
});

import pool from '../../db/connection';
import { feishuRequest, FeishuRateLimitError } from '../feishu-client';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
} from '../content-publish-dispatch';
import { InMemoryMaterialStorage } from '../material-storage';
import { runOnce, startFeishuOrchestrator } from '../feishu-orchestrator';

const TENANT = 'b0058fb7-645d-4d2b-ab25-8d9d4a764b29';
const OTHER_TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APP_TOKEN = 'app-tok-1';
const TABLE_ID = 'tbl-1';
const ENV = { appToken: APP_TOKEN, tableId: TABLE_ID, tenantId: TENANT };
const deps = () => ({ storage: new InMemoryMaterialStorage() });

const RECORDS_PATH = `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`;
const SEARCH_PATH = `${RECORDS_PATH}/search`;
const ROW_PATCH_PATH = `${RECORDS_PATH}/rec-1`;

/** 拉发方向 search 返回的行构造器：标题/文案/content_id 默认用 segment 数组形态。 */
function feishuRow(over: any = {}) {
  return {
    record_id: 'rec-1',
    fields: {
      '标题': [{ type: 'text', text: '新标题' }],
      '文案': [{ type: 'text', text: '新文案' }],
      '平台': ['douyin', 'weibo'],
      'content_id': [{ type: 'text', text: CID }],
      ...over,
    },
  };
}

function clearOrchEnv() {
  delete process.env.FEISHU_ORCH_APP_TOKEN;
  delete process.env.FEISHU_ORCH_TABLE_ID;
  delete process.env.FEISHU_ORCH_TENANT_ID;
  delete process.env.NOTION_ORCH_TENANT_ID;
}

beforeEach(() => {
  vi.clearAllMocks();
  (pool.query as any).mockResolvedValue({ rows: [] });
  (feishuRequest as any).mockImplementation(async (_m: string, path: string) => {
    if (path === SEARCH_PATH) return { code: 0, data: { items: [], has_more: false } };
    if (path === RECORDS_PATH) return { code: 0, data: { record: { record_id: 'rec-new' } } };
    return { code: 0, data: {} };
  });
  clearOrchEnv();
});

describe('启动自检', () => {
  it('缺 env → 红日志 + 返回 null 不启动', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = startFeishuOrchestrator();
    expect(t).toBeNull();
    expect(spy.mock.calls.flat().join(' ')).toContain('[feishu-orch]');
    spy.mockRestore();
  });
});

describe('租户互斥（单边拒启）', () => {
  it('FEISHU_ORCH_TENANT_ID 与 NOTION_ORCH_TENANT_ID 相同且非空 → 红日志拒启', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.FEISHU_ORCH_APP_TOKEN = APP_TOKEN;
    process.env.FEISHU_ORCH_TABLE_ID = TABLE_ID;
    process.env.FEISHU_ORCH_TENANT_ID = TENANT;
    process.env.NOTION_ORCH_TENANT_ID = TENANT;
    const t = startFeishuOrchestrator();
    expect(t).toBeNull();
    expect(spy.mock.calls.flat().join(' ')).toContain('冲突');
    spy.mockRestore();
  });

  it('两租户不同（或 Notion 侧未配置）→ 不因互斥拒启', () => {
    process.env.FEISHU_ORCH_APP_TOKEN = APP_TOKEN;
    process.env.FEISHU_ORCH_TABLE_ID = TABLE_ID;
    process.env.FEISHU_ORCH_TENANT_ID = TENANT;
    process.env.NOTION_ORCH_TENANT_ID = OTHER_TENANT;
    const t = startFeishuOrchestrator(100_000);
    expect(t).toBeTruthy();
    if (t) clearInterval(t);
  });
});

describe('方向A 推行（作品→飞书行）：Bitable 值形态合同', () => {
  function stubDraft() {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql) && /feishu_record_id IS NULL/i.test(sql)) {
        return {
          rows: [
            { id: CID, title: '治愈色', body: '文案', type: 'image', platforms: ['douyin', 'myspace'] },
          ],
        };
      }
      if (/FROM zenithjoy\.content_materials/i.test(sql)) {
        return { rows: [{ file_name: 'a.jpg', storage_key: 'k/a.jpg' }] };
      }
      return { rows: [] };
    });
  }

  it('值形态四断言：多选=字符串数组/单选=裸字符串/预览=对象{text,link}/文本=裸字符串', async () => {
    stubDraft();
    await runOnce(ENV, deps());
    const createCall = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === RECORDS_PATH);
    expect(createCall).toBeTruthy();
    const fields = createCall[2].fields;
    // 多选：字符串数组，且白名单过滤掉了飞书里不存在的 myspace
    expect(fields['平台']).toEqual(['douyin']);
    // 单选：裸字符串，不是 {select:{name}} 这种 Notion 形态
    expect(fields['状态']).toBe('草稿');
    // URL：{text, link} 对象
    expect(fields['预览']).toMatchObject({ text: '预览' });
    expect(typeof fields['预览'].link).toBe('string');
    // 文本：裸字符串，不是 Notion 的 rich_text 数组
    expect(fields['标题']).toBe('治愈色');
    expect(fields['文案']).toBe('文案');
    expect(fields['content_id']).toBe(CID);
  });

  it('锚回写：建行成功后 UPDATE contents.feishu_record_id', async () => {
    stubDraft();
    await runOnce(ENV, deps());
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET feishu_record_id/i.test(c[0]));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain(CID);
    expect(upd[1]).toContain('rec-new');
  });
});

describe('方向B 拉发（状态=发）', () => {
  function stubFireRow(row: any) {
    (feishuRequest as any).mockImplementation(async (_m: string, path: string) => {
      if (path === SEARCH_PATH) return { code: 0, data: { items: [row], has_more: false } };
      return { code: 0, data: {} };
    });
    (pool.query as any).mockImplementation(async (sql: string) => {
      // 只匹配"锚失效重派检查"的按 id 查 status（不匹配方向A 的 draft 候选查询，
      // 后者带 feishu_record_id IS NULL，此处刻意排除避免方向A 在本 describe 里空跑）。
      if (/FROM zenithjoy\.contents/i.test(sql) && !/feishu_record_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID }] };
      }
      return { rows: [] };
    });
  }

  it('search body 携带状态=发的过滤条件', async () => {
    stubFireRow(feishuRow());
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    const searchCall = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === SEARCH_PATH);
    expect(searchCall).toBeTruthy();
    expect(searchCall[2].filter.conditions[0]).toMatchObject({
      field_name: '状态',
      operator: 'is',
      value: ['发'],
    });
  });

  it('文本 segment 数组形态 → plainText 拼接正确，回写 title/body + dispatch + 行置排队中', async () => {
    stubFireRow(feishuRow());
    (dispatchContentPublish as any).mockResolvedValue({
      content_id: CID,
      tasks: [{ id: 't1', platform: 'douyin' }, { id: 't2', platform: 'weibo' }],
    });
    await runOnce(ENV, deps());
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd).toBeTruthy();
    expect(upd[1][0]).toBe('新标题');
    expect(upd[1][1]).toBe('新文案');
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: CID, tenantId: TENANT, platformsOverride: ['douyin', 'weibo'] }),
    );
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('排队中');
  });

  it('文本裸字符串形态（非 segment 数组）同样兼容拼接', async () => {
    stubFireRow(feishuRow({ '标题': '新标题2', '文案': '新文案2', 'content_id': CID }));
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd[1][0]).toBe('新标题2');
    expect(upd[1][1]).toBe('新文案2');
  });

  it('飞书手加的非法平台被白名单过滤，不进 dispatch', async () => {
    stubFireRow(feishuRow({ '平台': ['douyin', 'myspace'] }));
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ platformsOverride: ['douyin'] }),
    );
  });

  it('content_id 非 UUID → 锚失效：行置派发失败，dispatch 不被调', async () => {
    stubFireRow(feishuRow({ 'content_id': [{ type: 'text', text: 'not-a-uuid' }] }));
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).not.toHaveBeenCalled();
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('派发失败');
  });

  it('AlreadyQueued → 幂等成功：行置排队中', async () => {
    stubFireRow(feishuRow());
    (dispatchContentPublish as any).mockRejectedValue(new AlreadyQueuedError());
    await runOnce(ENV, deps());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('排队中');
  });

  it('NoActiveAgent → 行置派发失败且回执含人话原因', async () => {
    stubFireRow(feishuRow());
    (dispatchContentPublish as any).mockRejectedValue(new NoActiveAgentError());
    await runOnce(ENV, deps());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('派发失败');
    expect(patch[2].fields['回执']).toContain('agent');
  });

  it('作品已终态(published/failed) → 拒绝重派：行置派发失败+原因含已完成一轮发布，dispatch 不被调', async () => {
    stubFireRow(feishuRow());
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql) && !/feishu_record_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID, status: 'failed' }] };
      }
      return { rows: [] };
    });
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).not.toHaveBeenCalled();
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('派发失败');
    expect(patch[2].fields['回执']).toContain('已完成一轮发布');
  });

  it('分页：has_more+page_token → 继续拉下一页直到 has_more=false', async () => {
    let call = 0;
    (feishuRequest as any).mockImplementation(async (_m: string, path: string, body: any) => {
      if (path === SEARCH_PATH) {
        call += 1;
        if (call === 1) {
          expect(body.page_token).toBeUndefined();
          return { code: 0, data: { items: [], has_more: true, page_token: 'tok-2' } };
        }
        expect(body.page_token).toBe('tok-2');
        return { code: 0, data: { items: [], has_more: false } };
      }
      return { code: 0, data: {} };
    });
    await runOnce(ENV, deps());
    expect(call).toBe(2);
  });

  it('长文案 2500 字不被截断：segment 数组形态完整回写 contents', async () => {
    const longBody = 'A'.repeat(2500);
    function stubFireRowWithLongBody() {
      (feishuRequest as any).mockImplementation(async (_m: string, path: string) => {
        if (path === SEARCH_PATH) {
          return {
            code: 0,
            data: {
              items: [
                feishuRow({
                  '文案': [{ type: 'text', text: longBody }],
                }),
              ],
              has_more: false,
            },
          };
        }
        return { code: 0, data: {} };
      });
      (pool.query as any).mockImplementation(async (sql: string) => {
        if (/FROM zenithjoy\.contents/i.test(sql) && !/feishu_record_id IS NULL/i.test(sql)) {
          return { rows: [{ id: CID }] };
        }
        return { rows: [] };
      });
    }

    stubFireRowWithLongBody();
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd).toBeTruthy();
    expect(upd[1][1]).toBe(longBody);
    expect(upd[1][1].length).toBe(2500);
  });
});

describe('方向B 拉发定时闸（scheduled_at，Bitable 毫秒时间戳形态）', () => {
  const FUTURE_MS = Date.now() + 3_600_000;
  const PAST_MS = Date.now() - 3_600_000;

  function stubFireRow(row: any) {
    (feishuRequest as any).mockImplementation(async (_m: string, path: string) => {
      if (path === SEARCH_PATH) return { code: 0, data: { items: [row], has_more: false } };
      return { code: 0, data: {} };
    });
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql) && !/feishu_record_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID }] };
      }
      return { rows: [] };
    });
  }

  it('「定时」未到点 → 本轮整体跳过：不派、不回写、不动飞书行', async () => {
    stubFireRow(feishuRow({ '定时': FUTURE_MS }));
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).not.toHaveBeenCalled();
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd).toBeFalsy();
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch).toBeFalsy();
  });

  it('「定时」已到点 → 照常派，且回写 UPDATE 一并镜像 scheduled_at（毫秒→ISO）', async () => {
    stubFireRow(feishuRow({ '定时': PAST_MS }));
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: CID, tenantId: TENANT }),
    );
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd).toBeTruthy();
    expect(upd[0]).toMatch(/scheduled_at\s*=\s*\$\d+/);
    expect(upd[1]).toContain(new Date(PAST_MS).toISOString());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('排队中');
  });

  it('无「定时」→ 立即派（现行为回归），镜像 scheduled_at=null 清掉旧值', async () => {
    stubFireRow(feishuRow());
    (dispatchContentPublish as any).mockResolvedValue({ content_id: CID, tasks: [{ id: 't1', platform: 'douyin' }] });
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).toHaveBeenCalled();
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd).toBeTruthy();
    expect(upd[0]).toMatch(/scheduled_at\s*=\s*\$\d+/);
    expect(upd[1]).toContain(null);
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('排队中');
  });

  it('「定时」值不是有限数字 → fail-closed：跳过不派 + 红日志含定时解析失败', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFireRow(feishuRow({ '定时': 'not-a-timestamp' }));
    await runOnce(ENV, deps());
    expect(dispatchContentPublish).not.toHaveBeenCalled();
    const upd = (pool.query as any).mock.calls.find(
      (c: any[]) => /UPDATE zenithjoy\.contents/i.test(c[0]) && /SET title/i.test(c[0]),
    );
    expect(upd).toBeFalsy();
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch).toBeFalsy();
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('[feishu-orch]');
    expect(logged).toContain('定时解析失败');
    spy.mockRestore();
  });
});

describe('方向C 回执（任务终态→飞书行）', () => {
  function stubQueuedContent(taskRows: any[]) {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/status = 'queued'/i.test(sql) && /feishu_record_id IS NOT NULL/i.test(sql)) {
        return { rows: [{ id: CID, feishu_record_id: 'rec-1' }] };
      }
      if (/FROM zenithjoy\.publish_tasks/i.test(sql)) {
        return {
          rows: taskRows.map((t, i) => ({
            cid: CID,
            created_at: `2026-09-09T00:00:0${i}Z`,
            ...t,
          })),
        };
      }
      return { rows: [] };
    });
  }

  it('全部 done → 行状态已发 + contents 置 published', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'done', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('已发');
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'published'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('全部 completed → 行状态已发 + contents 置 published', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'completed', result: null },
      { platform: 'weibo', status: 'completed', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('已发');
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'published'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('有 failed → 部分失败 + contents 置 failed；回执文本截断 ≤1900', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'failed', result: { error: 'x'.repeat(3000) } },
    ]);
    await runOnce(ENV, deps());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch[2].fields['状态']).toBe('部分失败');
    expect(patch[2].fields['回执'].length).toBeLessThanOrEqual(1900);
    const upd = (pool.query as any).mock.calls.find((c: any[]) => /SET status = 'failed'/i.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('还有任务未终态 → 不写回执不改状态', async () => {
    stubQueuedContent([
      { platform: 'douyin', status: 'done', result: null },
      { platform: 'weibo', status: 'dispatched', result: null },
    ]);
    await runOnce(ENV, deps());
    const patch = (feishuRequest as any).mock.calls.find((c: any[]) => c[1] === ROW_PATCH_PATH);
    expect(patch).toBeFalsy();
  });
});

describe('飞书频控', () => {
  it('FeishuRateLimitError → console.error 跳过本轮，不炸不重试', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/FROM zenithjoy\.contents/i.test(sql) && /feishu_record_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID, title: 't', body: 'b', type: 'image', platforms: ['douyin'] }] };
      }
      return { rows: [] };
    });
    (feishuRequest as any).mockImplementation(async (_m: string, path: string) => {
      if (path === RECORDS_PATH) throw new FeishuRateLimitError('飞书频控: test');
      if (path === SEARCH_PATH) return { code: 0, data: { items: [], has_more: false } };
      return { code: 0, data: {} };
    });
    await expect(runOnce(ENV, deps())).resolves.not.toThrow();
    expect(spy.mock.calls.flat().join(' ')).toContain('频控');
    spy.mockRestore();
  });
});
