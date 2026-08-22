/**
 * 路③ Sprint D 测试夹具 —— 在 Sprint A 双企业种子 + Sprint B 行层 + Sprint C 视图层之上加「关联(Relation)」层的调用糖
 *
 * 禁 mock 边（合同 `## 禁 mock 边清单`）：
 *   - `routes/workbench.ts` ↔ `services/workbench-rows.service.ts` / `workbench.service.ts`：真调，禁 vi.mock 顶替；
 *   - 代码 ↔ `zenithjoy.db_rows.data`(JSONB) / `db_fields` / `db_tables` / `db_audit`：真 INSERT 真 SELECT，
 *     关联值(目标 row_id 数组)真落 `db_rows.data`、真反查；
 *   - `workbenchAuthGuard` ↔ 关联路由：走真 `/api/staff/feishu-login` 签的真会话 cookie，不伪造 cookie 串。
 * 唯一允许 mock 的边：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属环境端点重定向）。
 *
 * Sprint A/B/C 的种子逻辑一字不抄，直接复用它们那份基座夹具 —— 抄一遍就等于给种子行为分叉开了口子。
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

/** 路③ 端点族基址（Sprint A 已定，本刀关联端点挂同一 router 之下） */
export const DB_BASE = '/api/knowledge/db';

/** relation-candidates 成功响应 `data` 的三个 key（排序后逐字相等，合同 Response Schema §R1） */
export const CANDIDATES_ENVELOPE_KEYS = ['candidates', 'field_id', 'target_table_id'];

/** 单条候选记录的两个 key（排序后逐字相等） */
export const CANDIDATE_ITEM_KEYS = ['row_id', 'title'];

/** 候选记录禁用字段名：同族既有端点同义替换词，一个都不许出现 */
export const CANDIDATE_ITEM_BANNED_KEYS = ['id', 'label', 'name', 'text', 'value', 'display', 'primary'];

/** backrefs 成功响应 `data` 的两个 key（排序后逐字相等，合同 Response Schema §R2） */
export const BACKREFS_ENVELOPE_KEYS = ['backrefs', 'row_id'];

/** 单条反向引用的五个 key（排序后逐字相等） */
export const BACKREF_ITEM_KEYS = ['field_id', 'row_id', 'row_title', 'table_id', 'table_name'];

/** 反向引用禁用字段名 */
export const BACKREF_ITEM_BANNED_KEYS = [
  'id',
  'name',
  'title',
  'table',
  'source',
  'ref',
  'refs',
  'reference',
  'references',
  'incoming',
];

/** 建一张只含一个 text 主字段的极简表（关联目标/来源都用它，标题取 text 字段值） */
export async function createSimpleTable(
  cookie: string,
  name: string,
  visibility: 'org' | 'private'
) {
  return request(app)
    .post(`${DB_BASE}/tables`)
    .set('Cookie', cookie)
    .send({
      name,
      visibility,
      fields: [{ name: '标题', field_type: 'text', options: [], display_order: 0 }],
    });
}

/** 在 tableId 上新增一个 relation 字段，配置目标表 = targetTableId（存 options[0]） */
export async function addRelationField(
  cookie: string,
  tableId: string,
  targetTableId: string,
  name = '关联'
) {
  return request(app)
    .post(`${DB_BASE}/tables/${tableId}/fields`)
    .set('Cookie', cookie)
    .send({ fields: [{ name, field_type: 'relation', options: [targetTableId], display_order: 9 }] });
}

/** 取一张表的字段清单 */
export async function listFields(cookie: string, tableId: string) {
  return request(app).get(`${DB_BASE}/tables/${tableId}/fields`).set('Cookie', cookie);
}

/** 按 field_type 取该表第一个匹配字段的 field_id（未命中返回 undefined） */
export async function fieldIdOf(
  cookie: string,
  tableId: string,
  fieldType: string
): Promise<string | undefined> {
  const res = await listFields(cookie, tableId);
  const fields = res.body?.data?.fields ?? [];
  return fields.find((f: { field_type: string }) => f.field_type === fieldType)?.field_id;
}

/** 建一个空行并返回其 row_id（失败返回 undefined，让断言炸在具体位置） */
export async function seedRow(cookie: string, tableId: string): Promise<string | undefined> {
  const res = await request(app).post(`${DB_BASE}/tables/${tableId}/rows`).set('Cookie', cookie);
  return res.body?.data?.row_id;
}

/** 行内改格（PATCH /rows/:id，走 field_id → 值） */
export async function patchRow(
  cookie: string,
  rowId: string,
  version: number,
  data: Record<string, unknown>
) {
  return request(app)
    .patch(`${DB_BASE}/rows/${rowId}`)
    .set('Cookie', cookie)
    .send({ version, data });
}

/** 建一个 text 主字段有值的行，返回 { rowId, textFieldId } */
export async function seedTitledRow(
  cookie: string,
  tableId: string,
  title: string
): Promise<{ rowId: string; textFieldId: string }> {
  const textFieldId = (await fieldIdOf(cookie, tableId, 'text'))!;
  const rowId = (await seedRow(cookie, tableId))!;
  await patchRow(cookie, rowId, 1, { [textFieldId]: title });
  return { rowId, textFieldId };
}

/** 拉行选择器候选（GET /tables/:tableId/fields/:fieldId/relation-candidates） */
export async function getCandidates(cookie: string, tableId: string, fieldId: string) {
  return request(app)
    .get(`${DB_BASE}/tables/${tableId}/fields/${fieldId}/relation-candidates`)
    .set('Cookie', cookie);
}

/** 拉反向引用（GET /rows/:rowId/backrefs） */
export async function getBackrefs(cookie: string, rowId: string) {
  return request(app).get(`${DB_BASE}/rows/${rowId}/backrefs`).set('Cookie', cookie);
}

/** 软删字段（DELETE /tables/:tableId/fields/:fieldId，带 confirm_name 二次确认） */
export async function deleteField(
  cookie: string,
  tableId: string,
  fieldId: string,
  confirmName: string
) {
  return request(app)
    .delete(`${DB_BASE}/tables/${tableId}/fields/${fieldId}`)
    .set('Cookie', cookie)
    .send({ confirm_name: confirmName });
}

/** 软删行（DELETE /rows/:id） */
export async function deleteRow(cookie: string, rowId: string) {
  return request(app).delete(`${DB_BASE}/rows/${rowId}`).set('Cookie', cookie);
}

/** 软删表（DELETE /tables/:id，带 confirm_name） */
export async function deleteTable(cookie: string, tableId: string, confirmName: string) {
  return request(app)
    .delete(`${DB_BASE}/tables/${tableId}`)
    .set('Cookie', cookie)
    .send({ confirm_name: confirmName });
}

/** 还原表（POST /trash/:id/restore） */
export async function restoreTable(cookie: string, tableId: string) {
  return request(app).post(`${DB_BASE}/trash/${tableId}/restore`).set('Cookie', cookie);
}

/** 一个语法合法但库里绝不存在的 uuid（反枚举对照组） */
export function randomUuid(): string {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-8${h().slice(1)}-${h()}${h()}${h()}`;
}
