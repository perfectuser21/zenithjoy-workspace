/**
 * 路③ 结构化工作台 · 关联 service —— S4「关联连得上」（Sprint D）
 *
 * 承接前三刀的三条纪律，一条不改：
 *  1. **组织归属只来自入参 orgId**（由 workbenchAuthGuard 从会话解析）。本文件不认识请求体，
 *     也不认识任何请求头；每条 SQL 自带 org_id 条件是纵深防御。
 *  2. **零运行时 DDL / 零新建关联表**：关联值是 db_rows.data 里的一个 JSONB 数组（目标 row_id），
 *     目标表配置是 db_fields.options[0]。反向引用用 JSONB 反查（`@>` 包含），不建反向索引表。
 *  3. **软删**：候选/反查读路径统一按 deleted_at IS NULL 剔除已软删的目标行/来源行/表。
 *
 * 反枚举（A28）：跨组织的表 id、他人私有表、非 relation 字段、目标表已删、压根不存在 ——
 * 一律返 null，由路由翻成同一个 notFoundBody 404（连 timestamp 都不带）。区分它们 = 发枚举工具。
 *
 * A27② 读路径二次校验：候选只返回目标表里 org_id 与本会话相符的行 —— 就算库里被直接改脏
 * （某行 org 被越权写成他企业），这条 org 条件也会把它剔除，绝不泄露对方组织的记录标题。
 *
 * A29② 私有反向零泄露：反查「谁引用了我」时，来源表若是他人的「仅自己」私有表（visibility
 * = 'private' 且 owner_member_id ≠ 请求会话 memberId），整条来源从反向面板剔除；表主本人不剔除。
 */
import pool from '../db/connection';
import { getTable, listFieldRows, isUuid, RELATION_FIELD_TYPE, type FieldOut } from './workbench.service';

export interface RelationCandidate {
  row_id: string;
  title: string;
}

export interface RelationCandidatesOut {
  field_id: string;
  target_table_id: string;
  candidates: RelationCandidate[];
}

export interface Backref {
  field_id: string;
  row_id: string;
  row_title: string;
  table_id: string;
  table_name: string;
}

export interface BackrefsOut {
  row_id: string;
  backrefs: Backref[];
}

/** 一张表里 display_order 最小的活字段 = 标题字段（渲染候选/来源行的显示文本）。 */
function titleFieldOf(fields: FieldOut[]): FieldOut | undefined {
  return fields[0]; // listFieldRows 已按 display_order ASC 排序且滤掉软删
}

/** 取一行的显示标题：标题字段的值（转字符串），无值回落 row_id。 */
function rowTitle(data: Record<string, unknown>, titleField: FieldOut | undefined, rowId: string): string {
  if (!titleField) return rowId;
  const v = data?.[titleField.field_id];
  if (v === undefined || v === null || v === '') return rowId;
  return typeof v === 'string' ? v : String(v);
}

/**
 * 行选择器候选（GET /tables/:tableId/fields/:fieldId/relation-candidates）。
 *
 * 解析链：源表可见 → 该表上的 fieldId 是 relation 字段（未软删）→ 目标表（options[0]）可见 →
 * 列出目标表里本组织、未软删的行 + 标题。任一环解析不到 → null（路由翻 404，A28 反枚举同形）。
 */
export async function relationCandidates(
  orgId: string,
  memberId: string,
  tableId: string,
  fieldId: string
): Promise<RelationCandidatesOut | null> {
  if (!isUuid(tableId) || !isUuid(fieldId)) return null;
  // ① 源表可见（跨企业/私有非表主/不存在 → null）
  const srcTable = await getTable(orgId, memberId, tableId);
  if (!srcTable) return null;
  // ② fieldId 必须是该表上的 relation 字段（非 relation / 已软删 / 不属该表 → 404）
  const relField = srcTable.fields.find(
    (f) => f.field_id === fieldId && f.field_type === RELATION_FIELD_TYPE
  );
  if (!relField) return null;
  const targetTableId = relField.options[0];
  if (typeof targetTableId !== 'string' || !isUuid(targetTableId)) return null;
  // ③ 目标表可见（含 A30② 目标表软删 → getTable 返 null → 404）
  const targetTable = await getTable(orgId, memberId, targetTableId);
  if (!targetTable) return null;
  const titleField = titleFieldOf(targetTable.fields);
  // ④ 目标表里本组织、未软删的行（A27② 读路径二次校验：org_id 条件把越权脏行剔除）
  const r = await pool.query(
    `SELECT r.id, r.data
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL
      ORDER BY r.row_order ASC, r.created_at ASC`,
    [targetTableId, orgId]
  );
  const candidates: RelationCandidate[] = r.rows.map((row: Record<string, unknown>) => {
    const rowId = String(row.id);
    const data = (row.data ?? {}) as Record<string, unknown>;
    return { row_id: rowId, title: rowTitle(data, titleField, rowId) };
  });
  return { field_id: fieldId, target_table_id: targetTableId, candidates };
}

/**
 * 反向引用（GET /rows/:rowId/backrefs）——「谁引用了我」。
 *
 * JSONB 反查：找出本组织所有 relation 字段 f（未软删），其目标表（options[0]）= 被查行所在表；
 * 再找来源表里 `data -> f.id` 数组包含被查行 id 的活行。剔除：来源行/来源表已软删、来源表为
 * 他人「仅自己」私有表（A29②）。被查行本身不可解析/已软删 → null（404）。
 */
export async function backrefs(
  orgId: string,
  memberId: string,
  rowId: string
): Promise<BackrefsOut | null> {
  if (!isUuid(rowId)) return null;
  // 被查行必须存在、可见、未软删（表可见性 + org）
  const viewed = await pool.query(
    `SELECT r.table_id
       FROM zenithjoy.db_rows r
       JOIN zenithjoy.db_tables t ON t.id = r.table_id AND t.org_id = $2 AND t.deleted_at IS NULL
      WHERE r.id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL
        AND (t.visibility = 'org' OR t.owner_member_id = $3)`,
    [rowId, orgId, memberId]
  );
  if (viewed.rowCount === 0) return null;
  const viewedTableId = String(viewed.rows[0].table_id);

  // 反查来源行：来源表活、来源行活、relation 字段活且目标 = 被查行所在表、数组含被查行 id。
  // A29② 私有零泄露：来源表 private 且 owner ≠ 请求者 → 整条剔除（表主本人不剔除）。
  const r = await pool.query(
    `SELECT r.id AS src_row_id, r.data AS src_data,
            t.id AS src_table_id, t.name AS src_table_name,
            f.id AS field_id
       FROM zenithjoy.db_fields f
       JOIN zenithjoy.db_tables t
         ON t.id = f.table_id AND t.org_id = $2 AND t.deleted_at IS NULL
       JOIN zenithjoy.db_rows r
         ON r.table_id = f.table_id AND r.org_id = $2 AND r.deleted_at IS NULL
      WHERE f.org_id = $2
        AND f.field_type = $4
        AND f.deleted_at IS NULL
        AND f.options ->> 0 = $5
        AND (r.data -> (f.id)::text) @> to_jsonb($1::text)
        AND (t.visibility = 'org' OR t.owner_member_id = $3)
      ORDER BY t.name ASC, r.row_order ASC`,
    [rowId, orgId, memberId, RELATION_FIELD_TYPE, viewedTableId]
  );

  // 每条来源行的标题取其所在表 display_order 最小的活字段值（按表缓存字段清单，避免逐行查库）
  const titleFieldCache = new Map<string, FieldOut | undefined>();
  const backrefList: Backref[] = [];
  for (const row of r.rows as Array<Record<string, unknown>>) {
    const srcTableId = String(row.src_table_id);
    if (!titleFieldCache.has(srcTableId)) {
      titleFieldCache.set(srcTableId, titleFieldOf(await listFieldRows(srcTableId, orgId)));
    }
    const data = (row.src_data ?? {}) as Record<string, unknown>;
    const srcRowId = String(row.src_row_id);
    backrefList.push({
      field_id: String(row.field_id),
      row_id: srcRowId,
      row_title: rowTitle(data, titleFieldCache.get(srcTableId), srcRowId),
      table_id: srcTableId,
      table_name: String(row.src_table_name),
    });
  }
  return { row_id: rowId, backrefs: backrefList };
}
