import { createHash } from 'node:crypto';
import type { WorkspaceAdapter, WorkspaceDefinition, WorkspaceField, WorkspacePlatform } from './customer-workspace';

type Text = { plain_text?: string; text?: { content?: string } };
type Json = {
  code?: number; data?: Json; app?: Json; app_token?: string;
  results?: Json[]; items?: Json[]; has_more?: boolean; next_cursor?: string; page_token?: string;
  id?: string; table_id?: string; name?: string; field_name?: string; type?: string | number;
  object?: string; archived?: boolean; in_trash?: boolean;
  title?: Text[]; description?: Text[]; parent?: { page_id?: string };
  child_database?: { title?: string }; properties?: Record<string, { type?: string }>;
};
const rich = (content: string) => [{ type: 'text', text: { content } }];
const plain = (items: Text[] = []) => items.map(x => x.plain_text ?? x.text?.content ?? '').join('');
const shared: WorkspaceField[] = [{ name: '记录标识', type: 'text' }, { name: '来源版本', type: 'number' }, { name: '同步状态', type: 'text' }, { name: '维护来源', type: 'text' }];
export function workspaceFields(definition: WorkspaceDefinition) { return [...shared, ...definition.fields]; }
export function feishuTableName(definition: WorkspaceDefinition, marker: string) {
  return `${definition.name} [cw1-${createHash('sha256').update(marker).digest('hex').slice(0, 20)}]`;
}
export function createWorkspaceAdapter(platform: WorkspacePlatform, token: string, fetcher: typeof fetch = fetch): WorkspaceAdapter {
  if (!token) throw Error('workspace credential missing');
  if (!['notion', 'feishu'].includes(platform)) throw Error('unsupported workspace platform');
  const notion = platform === 'notion';
  const base = notion ? 'https://api.notion.com/v1' : 'https://open.feishu.cn/open-apis';
  async function request(method: string, path: string, body?: unknown): Promise<Json> {
    let response: Response;
    try {
      response = await fetcher(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(notion ? { 'Notion-Version': '2022-06-28' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch { throw Error(`${platform} ${method} response unknown; reconcile before retry`); }
    if (!response.ok) {
      const error = Object.assign(Error(`${platform} ${method} HTTP ${response.status}`), { definitelyNotCreated: method === 'POST' && [400, 401, 403, 404, 413, 422, 429].includes(response.status) });
      throw error;
    }
    const result = await response.json() as Json;
    if (!notion && result.code !== 0) throw Error(`feishu business error ${result.code}`);
    return result;
  }
  async function pages(path: string): Promise<Json[]> {
    const output: Json[] = [], seen = new Set<string>(); let cursor: string | undefined;
    do {
      const query = `${path}${path.includes('?') ? '&' : '?'}page_size=100${cursor ? `&${notion ? 'start_cursor' : 'page_token'}=${encodeURIComponent(cursor)}` : ''}`;
      const result = await request('GET', query), data = notion ? result : result.data;
      const items = notion ? data?.results : data?.items;
      if (!data || typeof data !== 'object' || !Array.isArray(items) || typeof data.has_more !== 'boolean') throw Error('workspace list readback incomplete');
      output.push(...items);
      if (!data.has_more) return output;
      cursor = notion ? data.next_cursor : data.page_token;
      if (!cursor || seen.has(cursor) || seen.size >= 100) throw Error('workspace pagination incomplete');
      seen.add(cursor);
    } while (cursor);
    return output;
  }
  const appPath = (parent: string) => `/bitable/v1/apps/${encodeURIComponent(parent)}`;
  return {
    async preflight(parent) {
      if (!parent || parent.length > 128 || /[^a-zA-Z0-9_-]/.test(parent)) throw Error('invalid workspace parent');
      const value = await request('GET', notion ? `/pages/${parent}` : appPath(parent));
      if (notion && (value.archived || value.in_trash || value.object !== 'page')) throw Error('workspace parent inaccessible');
      if (notion && value.id?.replace(/-/g, '').toLowerCase() !== parent.replace(/-/g, '').toLowerCase()) throw Error('workspace parent readback identity mismatch');
      if (!notion && value.data?.app?.app_token !== parent) throw Error('workspace parent readback identity mismatch');
    },
    async find(parent, marker, definition) {
      if (!notion) {
        const tables = await pages(appPath(parent) + '/tables');
        if (tables.some(x => typeof x.table_id !== 'string' || typeof x.name !== 'string')) throw Error('workspace table identity incomplete');
        return tables.filter(x => x.name === feishuTableName(definition, marker)).map(x => ({ id: x.table_id ?? '', marker }));
      }
      const blocks = await pages(`/blocks/${parent}/children`);
      if (blocks.some(x => typeof x.id !== 'string' || typeof x.type !== 'string' || x.type === 'child_database' && typeof x.child_database?.title !== 'string')) throw Error('workspace block identity incomplete');
      const matches = [];
      for (const block of blocks.filter(x => x.type === 'child_database' && x.child_database?.title === definition.name)) {
        const database = await request('GET', `/databases/${block.id}`);
        if (plain(database.description) === marker) matches.push({ id: block.id ?? '', marker });
      }
      return matches;
    },
    async create(parent, definition, marker) {
      if (notion) {
        const properties: Record<string, unknown> = { '名称': { title: {} } };
        for (const field of workspaceFields(definition)) {
          const type = field.type === 'text' ? 'rich_text' : field.type;
          properties[field.name] = { [type]: {} };
        }
        const result = await request('POST', '/databases', { parent: { type: 'page_id', page_id: parent }, title: rich(definition.name), description: rich(marker), is_inline: true, properties });
        return { id: result.id ?? '', marker };
      }
      const types = { text: 1, number: 2, checkbox: 7, url: 15 };
      const result = await request('POST', appPath(parent) + '/tables', { table: { name: feishuTableName(definition, marker), default_view_name: '全部记录', fields: [{ field_name: '名称', type: 1 }, ...workspaceFields(definition).map(f => ({ field_name: f.name, type: types[f.type] }))] } });
      return { id: result.data?.table_id ?? '', marker };
    },
    async verify(parent, resource, definition, marker) {
      if (notion) {
        const database = await request('GET', `/databases/${resource.id}`);
        const expectedParent = parent.replace(/-/g, '');
        if (database.archived || database.in_trash || database.parent?.page_id?.replace(/-/g, '') !== expectedParent || plain(database.description) !== marker || plain(database.title) !== definition.name) return false;
        const props = database.properties ?? {};
        return props['名称']?.type === 'title' && workspaceFields(definition).every(f => props[f.name]?.type === (f.type === 'text' ? 'rich_text' : f.type));
      }
      const tables = await pages(appPath(parent) + '/tables');
      if (!tables.some(x => x.table_id === resource.id && x.name === feishuTableName(definition, marker))) return false;
      const existing = await pages(appPath(parent) + `/tables/${resource.id}/fields`);
      const types = { text: 1, number: 2, checkbox: 7, url: 15 };
      return existing.some(x => x.field_name === '名称' && x.type === 1) && workspaceFields(definition).every(f => existing.some(x => x.field_name === f.name && x.type === types[f.type]));
    },
  };
}
