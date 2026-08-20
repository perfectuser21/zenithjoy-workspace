/**
 * 结构化工作台专用 fetch —— 只带会话 cookie，一个身份头都不拼。
 *
 * 解析器直接复用知识中枢那一份：两条路的服务端响应形状逐字相同（统一成功体
 * `{success, data}` / 统一失败体 `{success, data, error:{code,message}}`），
 * 各写一份解析器就等于给形状漂移开了口子。
 *
 * **绝不复用 admin 那条通道**：它会把两个明文身份头拼进请求，而路③ 的服务端闸
 * 压根不读请求头；更要紧的是那两个头是既有 16 个端点的唯一凭据，两条路各走各的。
 */
import { knowledgeJson, KnowledgeRequestError } from './knowledgeFetch';

export const WORKBENCH_BASE = '/api/knowledge/db';

/** 八类字段，与服务端 `db_fields.field_type` 的 CHECK 约束逐字对应 */
export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'single_select',
  'multi_select',
  'person',
  'url',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '单行文本',
  long_text: '多行文本',
  number: '数字',
  date: '日期',
  single_select: '单选',
  multi_select: '多选',
  person: '人员',
  url: '链接',
};

export interface WorkbenchField {
  field_id?: string;
  name: string;
  field_type: string;
  options: string[];
  display_order: number;
}

export interface WorkbenchTable {
  table_id: string;
  name: string;
  visibility: 'org' | 'private';
  field_count: number;
  created_at: string;
}

export interface WorkbenchTableDetail {
  table_id: string;
  org_id: string;
  name: string;
  visibility: 'org' | 'private';
  fields: WorkbenchField[];
  created_at: string;
}

export interface WorkbenchTemplate {
  template_key: string;
  name: string;
  fields: WorkbenchField[];
}

export interface TrashEntry {
  table_id: string;
  name: string;
  deleted_at: string;
  restorable_until: string;
}

const json = <T>(path: string, init?: RequestInit) => knowledgeJson<T>(`${WORKBENCH_BASE}${path}`, init);

export const listTemplates = () =>
  json<{ templates: WorkbenchTemplate[] }>('/templates').then((d) => d.templates);

export const listTables = () => json<{ tables: WorkbenchTable[] }>('/tables').then((d) => d.tables);

export const getTable = (id: string) => json<WorkbenchTableDetail>(`/tables/${id}`);

export const createTable = (payload: {
  name: string;
  visibility: 'org' | 'private';
  fields?: WorkbenchField[];
  template_key?: string;
}) => json<WorkbenchTableDetail>('/tables', { method: 'POST', body: JSON.stringify(payload) });

/** 二次确认：confirm_name 与表名逐字不等时服务端返 400 且一个字节都不改 */
export const deleteTable = (id: string, confirmName: string) =>
  json<{ table_id: string; deleted_at: string }>(`/tables/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm_name: confirmName }),
  });

export const listTrash = () => json<{ tables: TrashEntry[] }>('/trash').then((d) => d.tables);

export const restoreTable = (id: string) =>
  json<{ table_id: string; restored_at: string }>(`/trash/${id}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export { KnowledgeRequestError as WorkbenchRequestError };
