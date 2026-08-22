/**
 * 路③ Sprint C 测试夹具 —— 在 Sprint A 双企业种子 + Sprint B 行层之上加「视图」层的调用糖
 *
 * 禁 mock 边（合同 `## 禁 mock 边清单`）：
 *   - `routes/workbench.ts` ↔ `services/workbench-views.service.ts`：真调，禁 vi.mock 顶替；
 *   - 代码 ↔ `zenithjoy.db_view_prefs` / `db_audit` / `db_rows` / `db_fields`：真 INSERT 真 SELECT；
 *   - `workbenchAuthGuard` ↔ 视图路由：走真 `/api/staff/feishu-login` 签的真会话 cookie，不伪造 cookie 串。
 * 唯一允许 mock 的边：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属环境端点重定向）。
 *
 * Sprint A/B 的种子逻辑一字不抄，直接复用它们那两份夹具 —— 抄一遍就等于给种子行为分叉开了口子。
 */
import request from 'supertest';
import app from '../../../apps/api/src/app';

export {
  PGURL,
  EIGHT_FIELD_TYPES,
  eightFields,
  codeFor,
  seedTwoTenants,
  cleanupSeed,
  createTable,
  type TwoTenantSeed,
} from '../../08201151-员工知识中枢-路-结构化工作台-c86e37ff/tests/_workbench-fixture';

/** 路③ 端点族基址（Sprint A 已定，本刀视图端点挂同一 router 之下） */
export const DB_BASE = '/api/knowledge/db';

/** `View` 对象的十个 key（合同 Response Schema §2.1，排序后逐字相等） */
export const VIEW_KEYS = [
  'degraded',
  'filters',
  'group_field_id',
  'hidden_field_ids',
  'is_active',
  'name',
  'sorts',
  'updated_at',
  'view_id',
  'view_type',
];

/** 禁用字段名：同族既有端点的同义替换词 + AG Grid 原生词，`View` 里一个都不许出现 */
export const VIEW_BANNED_KEYS = [
  'id',
  'viewId',
  'type',
  'prefs',
  'config',
  'active',
  'groupBy',
  'group_by',
  'hiddenFields',
  'hidden_fields',
  'filterModel',
  'sortModel',
  'columns',
  'fallback',
];

export interface ViewPatch {
  name?: string;
  view_type?: 'grid' | 'kanban';
  filters?: Array<{ field_id: string; op: string; value: unknown }>;
  sorts?: Array<{ field_id: string; dir: string }>;
  group_field_id?: string | null;
  hidden_field_ids?: string[];
  is_active?: boolean;
  /** 只在 INV-1 的反向断言里用：证明服务端连读都不读 */
  org_id?: string;
  tenant_id?: string;
  member_id?: string;
}

export const listViews = (cookie: string, tableId: string) =>
  request(app).get(`${DB_BASE}/tables/${tableId}/views`).set('Cookie', cookie);

export const createView = (cookie: string, tableId: string, body: ViewPatch) =>
  request(app).post(`${DB_BASE}/tables/${tableId}/views`).set('Cookie', cookie).send(body);

export const patchView = (cookie: string, viewId: string, body: ViewPatch) =>
  request(app).patch(`${DB_BASE}/views/${viewId}`).set('Cookie', cookie).send(body);

export const deleteView = (cookie: string, viewId: string) =>
  request(app).delete(`${DB_BASE}/views/${viewId}`).set('Cookie', cookie);

export const assignedToMe = (cookie: string) =>
  request(app).get(`${DB_BASE}/assigned-to-me`).set('Cookie', cookie);

/** 带筛/排的行列表：query 参数是 URL-encoded JSON 数组，与 `View.filters`/`View.sorts` 逐字同形 */
export function listRowsWith(
  cookie: string,
  tableId: string,
  q: { filter?: unknown; sort?: unknown } = {}
) {
  const params: Record<string, string> = {};
  if (q.filter !== undefined) params.filter = JSON.stringify(q.filter);
  if (q.sort !== undefined) params.sort = JSON.stringify(q.sort);
  return request(app).get(`${DB_BASE}/tables/${tableId}/rows`).set('Cookie', cookie).query(params);
}

export const createRow = (cookie: string, tableId: string) =>
  request(app).post(`${DB_BASE}/tables/${tableId}/rows`).set('Cookie', cookie).send({});

export const patchRow = (
  cookie: string,
  rowId: string,
  version: number,
  data: Record<string, unknown>
) => request(app).patch(`${DB_BASE}/rows/${rowId}`).set('Cookie', cookie).send({ version, data });

/** 按 field_type 取稳定 field_id —— 视图里存的一律是它，不是字段名、不是列序号 */
export async function fieldIdOf(
  cookie: string,
  tableId: string,
  fieldType: string
): Promise<string> {
  const res = await request(app).get(`${DB_BASE}/tables/${tableId}/fields`).set('Cookie', cookie);
  const fields = (res.body?.data?.fields ?? []) as Array<{ field_id: string; field_type: string }>;
  return fields.find((f) => f.field_type === fieldType)?.field_id ?? '';
}

/** 建一行并写值，返回 row_id（筛排与看板两组用例的共同前置） */
export async function seedRow(
  cookie: string,
  tableId: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await createRow(cookie, tableId);
  const rowId = (created.body?.data?.row_id ?? '') as string;
  if (rowId && Object.keys(data).length > 0) await patchRow(cookie, rowId, 1, data);
  return rowId;
}

/** 随机 uuid：反枚举断言的对照组（「压根不存在的 id」） */
export function randomUuid(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (n: number) => Array.from({ length: n }, hex).join('');
  return `${seg(8)}-${seg(4)}-4${seg(3)}-8${seg(3)}-${seg(12)}`;
}
