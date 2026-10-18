import { describe, expect, it } from 'vitest';
import { createWorkspaceAdapter, workspaceFields, feishuTableName } from '../customer-workspace-adapters';
import { workspaceTemplate, provisionWorkspace, type WorkspaceState } from '../customer-workspace';

const parent = 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
const input = { company_id: 'company-a', tenant_id: 'tenant-a', company_name: '甲', platform: 'notion' as const, parent_id: parent, modules: ['leadgen'] };
describe('Notion与飞书开户API协议', () => {
  it('Notion完整16库开户、字段独立读回、二次执行不新增', async () => {
    const databases = new Map<string, any>(); let creates = 0;
    const fetcher = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname, method = init.method;
      if (path === `/v1/pages/${parent}`) return Response.json({ object: 'page', id: parent });
      if (path === `/v1/blocks/${parent}/children`) return Response.json({ results: [...databases.values()].map(d => ({ id: d.id, type: 'child_database', child_database: { title: d.title[0].text.content } })), has_more: false });
      if (path === '/v1/databases' && method === 'POST') {
        creates++; const body = JSON.parse(init.body as string), id = `database-${creates}`;
        const properties = Object.fromEntries(Object.entries(body.properties).map(([k, v]: [string, any]) => [k, { ...v, type: Object.keys(v)[0] }]));
        databases.set(id, { ...body, id, properties }); return Response.json({ id });
      }
      if (path.startsWith('/v1/databases/')) return Response.json(databases.get(path.split('/').pop()!));
      throw Error('unexpected API call');
    }) as typeof fetch;
    const adapter = createWorkspaceAdapter('notion', 'private-test-token', fetcher);
    let state: WorkspaceState = { ...input, template_version: 1, status: 'pending', resources: {} };
    const save = async (next: WorkspaceState) => { state = structuredClone(next); };
    await provisionWorkspace(input, state, adapter, save); await provisionWorkspace(input, state, adapter, save);
    expect(creates).toBe(16); expect(state.status).toBe('structure_ready');
    expect(state.data_sync_status).toBe('not_connected');
  });
  it('飞书使用base内独立表，验证真实表字段而非POST返回成功', async () => {
    const definition = workspaceTemplate(['leadgen']).find(d => d.key === 'keywords')!, marker = 'marker-a';
    let created: any;
    const fetcher = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (init.method === 'POST') { created = JSON.parse(init.body as string).table; return Response.json({ code: 0, data: { table_id: 'table-a' } }); }
      if (path.endsWith('/fields')) return Response.json({ code: 0, data: { items: created.fields, has_more: false } });
      if (path.endsWith('/tables')) return Response.json({ code: 0, data: { items: created ? [{ name: created.name, table_id: 'table-a' }] : [], has_more: false } });
      return Response.json({ code: 0, data: { app: { app_token: 'base-a' } } });
    }) as typeof fetch;
    const adapter = createWorkspaceAdapter('feishu', 'private-test-token', fetcher);
    await adapter.preflight('base-a'); expect(await adapter.find('base-a', marker, definition)).toEqual([]);
    const resource = await adapter.create('base-a', definition, marker);
    expect(await adapter.verify('base-a', resource, definition, marker)).toBe(true);
    expect(created.name).toBe(feishuTableName(definition, marker));
    expect(created.fields).toHaveLength(workspaceFields(definition).length + 1);
    created.fields.pop(); expect(await adapter.verify('base-a', resource, definition, marker)).toBe(false);
  });
  it('分页称有下一页但没游标时拒绝，禁止把不完整列表当空列表创建', async () => {
    const adapter = createWorkspaceAdapter('notion', 'private-test-token', (async () => Response.json({ results: [], has_more: true })) as typeof fetch);
    await expect(adapter.find(parent, 'marker-a', workspaceTemplate()[0])).rejects.toThrow('pagination');
  });
  it.each(['notion', 'feishu'] as const)('HTTP200缺失列表结构必须拒绝：%s', async platform => {
    const adapter = createWorkspaceAdapter(platform, 'private-test-token', (async () => Response.json(platform === 'notion' ? {} : { code: 0, data: {} })) as typeof fetch);
    await expect(adapter.find(platform === 'notion' ? parent : 'base-a', 'marker-a', workspaceTemplate()[0])).rejects.toThrow('readback incomplete');
  });
  it('同名但异公司标记的库不复用', async () => {
    const adapter = createWorkspaceAdapter('notion', 'private-test-token', (async (url: string) => Response.json(url.includes('/children') ? { results: [{ id: 'foreign-db', type: 'child_database', child_database: { title: '文档库' } }], has_more: false } : { description: [{ text: { content: 'foreign-company' } }] })) as typeof fetch);
    expect(await adapter.find(parent, 'marker-a', workspaceTemplate()[0])).toEqual([]);
  });
  it('未知响应错误中不包含token', async () => {
    const adapter = createWorkspaceAdapter('notion', 'private-test-token', (async () => { throw Error('Authorization private-test-token'); }) as typeof fetch);
    await expect(adapter.preflight(parent)).rejects.toThrow('response unknown');
    try { await adapter.preflight(parent); } catch (error) { expect(String(error)).not.toContain('private-test-token'); }
  });
});
