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

// ── 行层（Sprint B / S2「数据进得来」）────────────────────────────────────────

/** 单元格值：key 一律是稳定的 field_id，不是字段名、不是列序号 */
export type CellValue = string | number | string[] | null;

export interface WorkbenchRow {
  row_id: string;
  data: Record<string, CellValue>;
  /** 行级乐观锁基线：写回带它，服务端不匹配就返 409 而不是静默覆盖 */
  version: number;
  row_order: number;
  created_at: string;
  updated_at: string;
}

export interface RowTrashEntry {
  row_id: string;
  deleted_at: string;
  restorable_until: string;
}

export interface PasteOutcome {
  inserted: number;
  created_fields: Array<{ field_id: string; name: string; field_type: string }>;
  row_ids: string[];
}

export interface TableExport {
  table_id: string;
  name: string;
  fields: WorkbenchField[];
  rows: WorkbenchRow[];
  exported_at: string;
}

/**
 * 编辑器里的字符串 → 服务端要的类型。表格视图与行详情面板共用同一份，
 * 各写一份就等于给"同一个格在两处被解析成不同东西"开了口子。
 *
 * 空串一律当「清空该格」（服务端 null 合法）；数字解析不出来就把原串照发，
 * 由服务端返 400 VALIDATION_FAILED —— 前端不替用户编一个"看起来合理"的值。
 */
export function parseCellInput(fieldType: string, raw: string | string[]): CellValue {
  if (fieldType === 'multi_select') return Array.isArray(raw) ? raw : raw ? [raw] : [];
  const text = Array.isArray(raw) ? raw.join('') : raw;
  if (text === '') return null;
  if (fieldType === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

/** 上限由服务端下发（row_limit），前端据此硬拦——写死在前端就违反了「禁写死环境假设值」 */
export const listRows = (tableId: string) =>
  json<{ rows: WorkbenchRow[]; total: number; row_limit: number }>(`/tables/${tableId}/rows`);

export const createRow = (tableId: string) =>
  json<WorkbenchRow>(`/tables/${tableId}/rows`, { method: 'POST', body: JSON.stringify({}) });

/** data 是增量补丁，只含被改的那一格；返回的是合并后的整行与递增后的 version */
export const patchRow = (rowId: string, version: number, data: Record<string, CellValue>) =>
  json<WorkbenchRow>(`/rows/${rowId}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, data }),
  });

export const deleteRow = (rowId: string) =>
  json<{ row_id: string; deleted_at: string }>(`/rows/${rowId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });

export const restoreRow = (rowId: string) =>
  json<WorkbenchRow>(`/rows/${rowId}/restore`, { method: 'POST', body: JSON.stringify({}) });

export const listRowTrash = (tableId: string) =>
  json<{ rows: RowTrashEntry[] }>(`/tables/${tableId}/rows/trash`).then((d) => d.rows);

export const pasteRows = (tableId: string, header: string[], rows: string[][]) =>
  json<PasteOutcome>(`/tables/${tableId}/rows/paste`, {
    method: 'POST',
    body: JSON.stringify({ header, rows }),
  });

export const exportTable = (tableId: string) => json<TableExport>(`/tables/${tableId}/export`);

export { KnowledgeRequestError as WorkbenchRequestError };
