/**
 * 路③ Sprint B 测试夹具 —— 在 Sprint A 双企业种子之上加「行」层的调用糖
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ zenithjoy.db_rows / db_fields / db_audit：真 INSERT 真 SELECT，不 stub DB 层；
 *   - workbenchAuthGuard ↔ 行路由：走真 /api/staff/feishu-login 签的真会话 cookie，不伪造 cookie 串；
 *   - 行 version 状态机：并发用例发**两个真请求**，禁用手改 version 的伪并发。
 * 唯一允许 mock 的边：飞书 OAuth 上游（FEISHU_API_BASE 指向本地假上游，属环境端点重定向）。
 *
 * Sprint A 的种子逻辑一字不抄，直接复用它那份夹具 —— 抄一遍就等于给两套种子行为分叉开了口子。
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

/** 路③ 端点族基址（Sprint A 已定，本刀行端点挂同一 router 之下） */
export const DB_BASE = '/api/knowledge/db';

/** 按 field_type 取稳定 field_id —— PATCH 的 data key 一律是它，不是字段名、不是列序号 */
export async function fieldIdOf(cookie: string, tableId: string, fieldType: string): Promise<string> {
  const res = await request(app).get(`${DB_BASE}/tables/${tableId}/fields`).set('Cookie', cookie);
  const fields = (res.body?.data?.fields ?? []) as Array<{ field_id: string; field_type: string }>;
  return fields.find((f) => f.field_type === fieldType)?.field_id ?? '';
}

export const listRows = (cookie: string, tableId: string) =>
  request(app).get(`${DB_BASE}/tables/${tableId}/rows`).set('Cookie', cookie);

export const createRow = (cookie: string, tableId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`${DB_BASE}/tables/${tableId}/rows`).set('Cookie', cookie).send(body);

export const patchRow = (
  cookie: string,
  rowId: string,
  version: number,
  data: Record<string, unknown>
) => request(app).patch(`${DB_BASE}/rows/${rowId}`).set('Cookie', cookie).send({ version, data });

export const deleteRow = (cookie: string, rowId: string) =>
  request(app).delete(`${DB_BASE}/rows/${rowId}`).set('Cookie', cookie);

export const listRowTrash = (cookie: string, tableId: string) =>
  request(app).get(`${DB_BASE}/tables/${tableId}/rows/trash`).set('Cookie', cookie);

export const restoreRow = (cookie: string, rowId: string) =>
  request(app).post(`${DB_BASE}/rows/${rowId}/restore`).set('Cookie', cookie).send({});

export const pasteRows = (cookie: string, tableId: string, header: string[], rows: string[][]) =>
  request(app)
    .post(`${DB_BASE}/tables/${tableId}/rows/paste`)
    .set('Cookie', cookie)
    .send({ header, rows });

export const exportTable = (cookie: string, tableId: string) =>
  request(app).get(`${DB_BASE}/tables/${tableId}/export`).set('Cookie', cookie);
