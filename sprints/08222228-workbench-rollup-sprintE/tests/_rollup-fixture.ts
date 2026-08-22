/**
 * 路③ Sprint E 测试夹具 —— 在 Sprint D「关联(Relation)」层之上加「rollup/lookup 聚合」层的调用糖
 *
 * 承接前四刀的禁 mock 边（合同 `## 禁 mock 边清单`），一条不改：
 *   - `routes/workbench.ts` ↔ `services/workbench-rollup.service.ts` / `workbench.service.ts`：真调，禁 vi.mock 顶替；
 *   - 代码 ↔ `zenithjoy.db_rows.data`(JSONB)：聚合读顺 relation 目标 row_ids 去目标表捞值，真 SELECT，
 *     含 JSONB 数字以 string 存（`"12"`）的规整验证；
 *   - 代码 ↔ `zenithjoy.db_fields`：rollup/lookup 配置以三元组落 `options`（读时计算不落库、零新表），
 *     relation 字段/目标字段软删触发降级，真查库；
 *   - 代码 ↔ `zenithjoy.db_tables`：目标表软删 → getTable 返 null → 降级（A39③），真软删真查；
 *   - `workbenchAuthGuard` ↔ rollups 路由：走真会话 cookie，不伪造 cookie 串。
 * 唯一允许 mock 的边：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属环境端点重定向）。
 *
 * Sprint A/B/C/D 的种子/关联逻辑一字不抄，直接复用它们那份基座夹具 —— 抄一遍就等于给行为分叉开口子。
 */
import request from 'supertest';
import app from '../../../apps/api/src/app';

// 基座 + 关联层调用糖：全部从 Sprint D 关联夹具透传（它又从 Sprint A 基座夹具透传）
export {
  PGURL,
  seedTwoTenants,
  cleanupSeed,
  DB_BASE,
  createSimpleTable,
  addRelationField,
  listFields,
  fieldIdOf,
  seedRow,
  patchRow,
  seedTitledRow,
  getCandidates,
  deleteRow,
  deleteTable,
  restoreTable,
  deleteField,
  randomUuid,
  type TwoTenantSeed,
} from '../../08220300-workbench-sprintD-relations/tests/_relations-fixture';

import {
  DB_BASE,
  patchRow,
  fieldIdOf,
  seedRow,
} from '../../08220300-workbench-sprintD-relations/tests/_relations-fixture';

/** rollups 成功响应 `data` 的两个 key（排序后逐字相等，合同 Response Schema §R1） */
export const ROLLUP_ENVELOPE_KEYS = ['cells', 'table_id'];

/** 单个 rollup 单元格的五个 key（排序后逐字相等） */
export const ROLLUP_CELL_KEYS = ['degraded', 'field_id', 'fn', 'row_id', 'value'];

/** rollup 单元格禁用字段名：同族既有端点同义替换词，一个都不许出现（value 是合法 key，不列入禁用） */
export const ROLLUP_CELL_BANNED_KEYS = [
  'id',
  'name',
  'title',
  'label',
  'text',
  'display',
  'aggregate',
  'function',
  'result',
  'cell',
];

/** rollups 端点承认的六个聚合函数名（fn 字段取值域，逐字钉死） */
export const ROLLUP_FNS = ['count', 'sum', 'min', 'max', 'concat', 'lookup'];

/**
 * 建一张「目标表」：标题(text, display_order=0) + 金额(number, display_order=1)。
 * concat/lookup 取标题、sum/min/max 取金额，一张表覆盖全部六函数的目标口径。
 */
export async function createTargetTable(
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
      fields: [
        { name: '标题', field_type: 'text', options: [], display_order: 0 },
        { name: '金额', field_type: 'number', options: [], display_order: 1 },
      ],
    });
}

/**
 * 在 tableId 上新增一个 **rollup** 字段。
 * 配置三元组存 options 位序：`[relation_field_id, target_field_id, aggregate_fn]`（合同 J14）。
 * count 不需要目标字段，target_field_id 传空串即可。
 */
export async function addRollupField(
  cookie: string,
  tableId: string,
  relationFieldId: string,
  targetFieldId: string,
  fn: string,
  name = `rollup-${fn}`
) {
  return request(app)
    .post(`${DB_BASE}/tables/${tableId}/fields`)
    .set('Cookie', cookie)
    .send({
      fields: [
        {
          name,
          field_type: 'rollup',
          options: [relationFieldId, targetFieldId, fn],
          display_order: 20,
        },
      ],
    });
}

/**
 * 在 tableId 上新增一个 **lookup** 字段。
 * 配置存 options 位序：`[relation_field_id, target_field_id]`（fn 隐含为 lookup，合同 J14）。
 */
export async function addLookupField(
  cookie: string,
  tableId: string,
  relationFieldId: string,
  targetFieldId: string,
  name = 'lookup'
) {
  return request(app)
    .post(`${DB_BASE}/tables/${tableId}/fields`)
    .set('Cookie', cookie)
    .send({
      fields: [
        {
          name,
          field_type: 'lookup',
          options: [relationFieldId, targetFieldId],
          display_order: 21,
        },
      ],
    });
}

/** 拉一张表的 rollup 聚合值（GET /tables/:tableId/rollups，只读，读时计算不落库） */
export async function getRollups(cookie: string, tableId: string) {
  return request(app).get(`${DB_BASE}/tables/${tableId}/rollups`).set('Cookie', cookie);
}

/** 从 rollups 响应里取某 (row_id, field_id) 的单元格；未命中返回 undefined，让断言炸在具体位置。 */
export function rollupCell(
  body: { data?: { cells?: Array<{ row_id: string; field_id: string }> } },
  rowId: string,
  fieldId: string
): { row_id: string; field_id: string; fn: string; value: number | string | null; degraded: boolean } | undefined {
  const cells = body?.data?.cells ?? [];
  return cells.find((c) => c.row_id === rowId && c.field_id === fieldId) as
    | { row_id: string; field_id: string; fn: string; value: number | string | null; degraded: boolean }
    | undefined;
}

/**
 * 建一条目标行：标题字段(text) + 金额字段(number) 各给值。
 * 返回 rowId。金额走 API PATCH（number 类型校验放行真数字）。
 */
export async function seedTargetRow(
  cookie: string,
  tableId: string,
  title: string,
  amount: number
): Promise<string> {
  const titleFieldId = (await fieldIdOf(cookie, tableId, 'text'))!;
  const numberFieldId = (await fieldIdOf(cookie, tableId, 'number'))!;
  const rowId = (await seedRow(cookie, tableId))!;
  await patchRow(cookie, rowId, 1, { [titleFieldId]: title, [numberFieldId]: amount });
  return rowId;
}

/**
 * 直接把某目标行金额字段的库值写成任意 JSONB（模拟「粘贴导入一律文本」导致 JSONB 数字以
 * string 存 / 混入非数值）。绕过 API 类型校验，真写 db_rows.data —— A37 数值规整的种子入口。
 */
export async function forceCellValue(
  client: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  rowId: string,
  fieldId: string,
  rawJsonbText: string
): Promise<void> {
  await client.query(
    `UPDATE zenithjoy.db_rows SET data = jsonb_set(data, ARRAY[$2], to_jsonb($3::text)) WHERE id = $1`,
    [rowId, fieldId, rawJsonbText]
  );
}
