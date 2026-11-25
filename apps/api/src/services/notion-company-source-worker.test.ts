import { expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../db/connection', () => ({ default: { query } }));
import { notionSyncBinding, startNotionCompanySourceWorker } from './notion-company-source-worker';
import { createWorkspaceAdapter } from './customer-workspace-adapters';

const workspace = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', table = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const creator = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

it('登记只接收有效的 Notion 数据库、已批准编辑者，规范化身份', () => {
  expect(notionSyncBinding({ database_id: table, approved_editors: [] })).toBeNull();
  expect(notionSyncBinding({ database_id: 'https://other.example', approved_editors: [creator] })).toBeNull();
  expect(notionSyncBinding({ database_id: table.toUpperCase(), approved_editors: [creator, creator] })).toEqual({
    database_id: table, approved_editors: [creator.replaceAll('-', '')],
  });
});

it('启用前不轮询生产工作台', () => {
  vi.stubEnv('NOTION_COMPANY_SOURCE_SYNC_ENABLED', 'false');
  try {
    expect(startNotionCompanySourceWorker(row => row)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});

it('只查询绑定表的待同步请求，将版本结果写回原请求页', async () => {
  const call = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ parent: { page_id: workspace }, properties: {
      同步状态: { type: 'select' }, 同步回执: { type: 'rich_text' },
    } }))
    .mockResolvedValueOnce(Response.json({ results: [{ id: 'request', created_by: { id: creator }, last_edited_by: { id: creator } }] }))
    .mockResolvedValueOnce(Response.json({}));
  const adapter = createWorkspaceAdapter('notion', 'fixture', call);
  expect(await adapter.readSyncRequests(workspace, table)).toEqual([{ id: 'request', creator, editor: creator }]);
  expect(JSON.parse(String(call.mock.calls[1][1]?.body))).toMatchObject({ filter: { property: '同步状态', select: { equals: '待同步' } } });
  await adapter.writeSyncReceipt('request', true, '已启用 v4');
  expect(call.mock.calls[2][0]).toBe('https://api.notion.com/v1/pages/request');
  expect(JSON.parse(String(call.mock.calls[2][1]?.body))).toMatchObject({ properties: {
    同步状态: { select: { name: '已同步' } },
    同步回执: { rich_text: [{ text: { content: '已启用 v4' } }] },
  } });
});
