/**
 * 路③ 结构化工作台 service —— db_tables / db_fields 的读写
 *
 * 三条不可让步的纪律：
 *  1. **组织归属只来自入参 orgId**（由 workbenchAuthGuard 从会话解析）。本文件不认识请求体，
 *     也不认识任何请求头——想传错都没有入口。
 *  2. **零运行时 DDL**：用户建的"表"是 db_tables 的一行，字段是 db_fields 的行，
 *     单元格将来是 db_rows.data 的 JSONB 键值。用户输入永远走绑定参数当数据值，
 *     永不拼进 SQL 标识符位。
 *  3. **软删**：删表只打 deleted_at，物理行一条不少，30 天内可原样还原。
 *
 * 反枚举：跨组织的 id、他人的 private 表、压根不存在的 id —— 三种情形在本层一律返回
 * null，由路由统一翻译成同一个 404 体。绝不用 403 把「存在但没权限」区分出来。
 */
import type { Pool, PoolClient } from 'pg';
import pool from '../db/connection';
import { findTemplate, type TemplateField } from '../knowledge/workbench-templates';

/** 八类字段，逐字不可改名（合同 Response Schema） */
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

/**
 * relation 是第九类**内部**字段类型（Sprint D / S4 跨表关联）。它不进 `FIELD_TYPES`
 * ——那是用户面板里的八类，且被 workbench.service.test.ts 逐字钉死为 8——而是单列一条，
 * 只在服务端接受它作为合法 field_type、并触发关联目标表的可见性校验。
 */
export const RELATION_FIELD_TYPE = 'relation';

/**
 * rollup / lookup 是第十/十一类**内部**字段类型（Sprint E / S4 加厚聚合）。同 relation，
 * 它们不进 `FIELD_TYPES`（那是用户面板里的八类、被 workbench.service.test.ts 逐字钉死为 8），
 * 只在服务端接受为合法 field_type。rollup 配置以位序三元组 `[relation_field_id, target_field_id, fn]`
 * 存 options；lookup 存 `[relation_field_id, target_field_id]`（fn 隐含为 lookup）。读时计算不落库。
 */
export const ROLLUP_FIELD_TYPE = 'rollup';
export const LOOKUP_FIELD_TYPE = 'lookup';

/** rollup 允许的五个聚合函数（fn 白名单，逐字钉死；lookup 的 fn 隐含为 'lookup' 不在此列）。 */
export const ROLLUP_AGGREGATE_FNS: readonly string[] = ['count', 'sum', 'min', 'max', 'concat'];

/** 建字段/校验时真正放行的类型集合：八类 + relation + rollup + lookup。库层 CHECK 与之逐字对齐。 */
export const ACCEPTED_FIELD_TYPES: readonly string[] = [
  ...FIELD_TYPES,
  RELATION_FIELD_TYPE,
  ROLLUP_FIELD_TYPE,
  LOOKUP_FIELD_TYPE,
];

/** 回收站窗口：30 天。restorable_until = deleted_at + TRASH_RETENTION_DAYS */
export const TRASH_RETENTION_DAYS = 30;

export interface FieldInput {
  name: string;
  field_type: string;
  options?: string[];
  display_order?: number;
}

export interface FieldOut {
  field_id: string;
  name: string;
  field_type: string;
  options: string[];
  display_order: number;
}

export interface TableDetail {
  table_id: string;
  org_id: string;
  name: string;
  visibility: 'org' | 'private';
  fields: FieldOut[];
  created_at: string;
}

export interface TableSummary {
  table_id: string;
  name: string;
  visibility: 'org' | 'private';
  field_count: number;
  created_at: string;
}

export interface TrashEntry {
  table_id: string;
  name: string;
  deleted_at: string;
  restorable_until: string;
}

export class WorkbenchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbenchValidationError';
  }
}

/** 表名/可见性/字段定义的入参校验。用户输入不可信，但身份可信——所以只校验形状，不校验意图。 */
export function normalizeFields(raw: unknown): FieldInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new WorkbenchValidationError('fields 必须是数组');
  return raw.map((item, idx) => {
    const f = item as Record<string, unknown>;
    const name = typeof f?.name === 'string' ? f.name : '';
    const fieldType = typeof f?.field_type === 'string' ? f.field_type : '';
    if (!name) throw new WorkbenchValidationError(`第 ${idx + 1} 个字段缺 name`);
    if (!ACCEPTED_FIELD_TYPES.includes(fieldType)) {
      throw new WorkbenchValidationError(`第 ${idx + 1} 个字段的 field_type 不在八类之内`);
    }
    const options = Array.isArray(f?.options) ? (f.options as unknown[]).map((o) => String(o)) : [];
    const order = typeof f?.display_order === 'number' ? f.display_order : idx;
    return { name, field_type: fieldType, options, display_order: order };
  });
}

function templateToFields(fields: TemplateField[]): FieldInput[] {
  return fields.map((f) => ({
    name: f.name,
    field_type: f.field_type,
    options: [...f.options],
    display_order: f.display_order,
  }));
}

function rowToFieldOut(r: Record<string, unknown>): FieldOut {
  return {
    field_id: String(r.id),
    name: String(r.name),
    field_type: String(r.field_type),
    options: Array.isArray(r.options) ? (r.options as string[]) : [],
    display_order: Number(r.display_order),
  };
}

async function insertFields(
  client: PoolClient,
  tableId: string,
  orgId: string,
  fields: FieldInput[]
): Promise<FieldOut[]> {
  const out: FieldOut[] = [];
  for (const f of fields) {
    const r = await client.query(
      `INSERT INTO zenithjoy.db_fields (table_id, org_id, name, field_type, options, display_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, name, field_type, options, display_order`,
      [tableId, orgId, f.name, f.field_type, JSON.stringify(f.options ?? []), f.display_order ?? 0]
    );
    out.push(rowToFieldOut(r.rows[0]));
  }
  return out;
}

/**
 * 建表。整事务：表行 + 全部字段行 + 审计行，中途失败整体回滚，零残留。
 * template_key 与 fields 同时给时以 fields 为准（用户显式声明优先于模板默认）。
 */
export async function createTable(params: {
  orgId: string;
  memberId: string;
  name: string;
  visibility: string;
  fields?: unknown;
  templateKey?: string;
}): Promise<TableDetail> {
  const name = typeof params.name === 'string' ? params.name : '';
  if (!name.trim()) throw new WorkbenchValidationError('表名不能为空');
  const visibility = params.visibility === 'private' ? 'private' : 'org';

  let fields = normalizeFields(params.fields);
  let templateKey: string | null = null;
  if (fields.length === 0 && params.templateKey) {
    const tpl = findTemplate(params.templateKey);
    if (!tpl) throw new WorkbenchValidationError('template_key 不存在');
    fields = templateToFields(tpl.fields);
    templateKey = tpl.template_key;
  }

  // relation 字段（若建表时即声明）的目标表同样必须本组织可见（A27①/A31①）
  await assertRelationTargetsVisible(params.orgId, params.memberId, fields);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query(
      `INSERT INTO zenithjoy.db_tables (org_id, name, visibility, owner_member_id, template_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, org_id::text AS org_id, name, visibility, created_at`,
      [params.orgId, name, visibility, params.memberId, templateKey]
    );
    const row = t.rows[0];
    const tableId = String(row.id);
    const fieldRows = await insertFields(client, tableId, params.orgId, fields);
    await client.query(
      `INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
       VALUES ($1, $2, $3, 'create_table', $4::jsonb)`,
      [params.orgId, tableId, params.memberId, JSON.stringify({ field_count: fieldRows.length })]
    );
    await client.query('COMMIT');
    return {
      table_id: tableId,
      org_id: String(row.org_id),
      name: String(row.name),
      visibility: row.visibility as 'org' | 'private',
      fields: fieldRows,
      created_at: new Date(row.created_at).toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 本组织可见表列表：组织可见的全部 + 自己的私有表。软删的不出现在这里。 */
export async function listTables(orgId: string, memberId: string): Promise<TableSummary[]> {
  const r = await pool.query(
    `SELECT t.id, t.name, t.visibility, t.created_at,
            (SELECT count(*) FROM zenithjoy.db_fields f
              WHERE f.table_id = t.id AND f.org_id = t.org_id)::int AS field_count
       FROM zenithjoy.db_tables t
      WHERE t.org_id = $1
        AND t.deleted_at IS NULL
        AND (t.visibility = 'org' OR t.owner_member_id = $2)
      ORDER BY t.created_at DESC`,
    [orgId, memberId]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    table_id: String(row.id),
    name: String(row.name),
    visibility: row.visibility as 'org' | 'private',
    field_count: Number(row.field_count),
    created_at: new Date(row.created_at as string).toISOString(),
  }));
}

/**
 * 表详情。跨组织 / 他人的 private 表 / 不存在 —— 三种情形一律返 null，
 * 由路由翻成同一个 404。区分它们就是给攻击者发枚举工具。
 */
export async function getTable(
  orgId: string,
  memberId: string,
  tableId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<TableDetail | null> {
  if (!isUuid(tableId)) return null;
  const deletedClause = opts.includeDeleted ? '' : 'AND t.deleted_at IS NULL';
  const t = await pool.query(
    `SELECT t.id, t.org_id::text AS org_id, t.name, t.visibility, t.created_at
       FROM zenithjoy.db_tables t
      WHERE t.id = $1 AND t.org_id = $2 ${deletedClause}
        AND (t.visibility = 'org' OR t.owner_member_id = $3)`,
    [tableId, orgId, memberId]
  );
  if (t.rowCount === 0) return null;
  const row = t.rows[0];
  const fields = await listFieldRows(tableId, orgId);
  return {
    table_id: String(row.id),
    org_id: String(row.org_id),
    name: String(row.name),
    visibility: row.visibility as 'org' | 'private',
    fields,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * 字段行读取。org_id 条件不能省 —— 调用方已经验过表的归属，但每条 SQL 自带租户条件是
 * 纵深防御：将来多一个调用方忘了先查表，这里仍然漏不出去（INV-1 的静态守卫就钉这一条）。
 */
export async function listFieldRows(
  tableId: string,
  orgId: string,
  db: Pool | PoolClient = pool
): Promise<FieldOut[]> {
  const r = await db.query(
    `SELECT id, name, field_type, options, display_order
       FROM zenithjoy.db_fields WHERE table_id = $1 AND org_id = $2 AND deleted_at IS NULL
      ORDER BY display_order ASC, created_at ASC`,
    [tableId, orgId]
  );
  return r.rows.map(rowToFieldOut);
}

/**
 * relation 字段的目标表可见性校验（A27① 写入侧 / A31① 私有表）。
 *
 * 关联目标表（options[0]）必须是**本组织、本会话可见、未软删**的表 —— 跨企业表、他人的
 * 「仅自己」私有表、不存在的 id 一律不可解析 → 抛校验失败（路由翻 400）。目标 id 全程走
 * getTable 的绑定参数当数据值，永不进 SQL 标识符位。
 */
export async function assertRelationTargetsVisible(
  orgId: string,
  memberId: string,
  fields: FieldInput[]
): Promise<void> {
  for (const f of fields) {
    if (f.field_type !== RELATION_FIELD_TYPE) continue;
    const target = f.options?.[0];
    if (!target || typeof target !== 'string' || !isUuid(target)) {
      throw new WorkbenchValidationError(`关联字段「${f.name}」缺合法的目标表 id`);
    }
    const t = await getTable(orgId, memberId, target);
    if (!t) throw new WorkbenchValidationError(`关联字段「${f.name}」的目标表不可用或不可见`);
  }
}

/**
 * rollup / lookup 字段的类型×函数校验（A40 建字段时）。
 *
 * 配置三元组 `options = [relation_field_id, target_field_id, fn]`（lookup 无 fn 位，fn 隐含 lookup）。
 * 逐项校验、任一不过即抛 WorkbenchValidationError（路由翻 400 VALIDATION_FAILED + 明确文案，
 * 绝不放行成读时静默 NaN/错值）：
 *   ① relation_field_id 必须是**本表**存活的 relation 字段（不可解析即拒——防把 rollup 挂到不存在
 *      的关联上）。existingFields 是本表当前活字段清单（addFields 传 t.fields）。
 *   ② 目标表（relation.options[0]）必须本会话可见（跨企业/私有非表主/软删 → getTable 返 null → 拒）。
 *   ③ fn 白名单：rollup 的 fn ∈ {count,sum,min,max,concat}；非法（如 avg）→ 拒。
 *   ④ 类型×函数：sum/min/max 只允 number 目标字段；count 无需目标字段；concat/lookup 允任意
 *      目标字段类型（但目标字段必须存在）。
 */
export async function assertRollupConfigValid(
  orgId: string,
  memberId: string,
  existingFields: FieldOut[],
  incoming: FieldInput[]
): Promise<void> {
  for (const f of incoming) {
    const isRollup = f.field_type === ROLLUP_FIELD_TYPE;
    const isLookup = f.field_type === LOOKUP_FIELD_TYPE;
    if (!isRollup && !isLookup) continue;

    const opts = f.options ?? [];
    const relFieldId = opts[0];
    // ① relation_field_id 必须是本表存活 relation 字段
    const relField = existingFields.find(
      (x) => x.field_id === relFieldId && x.field_type === RELATION_FIELD_TYPE
    );
    if (!relField) {
      throw new WorkbenchValidationError(
        `汇总字段「${f.name}」的关联字段无效：必须选本表一个已有的关联字段`
      );
    }
    // ② 目标表可见（跨企业/私有非表主/软删一律不可解析）
    const targetTableId = relField.options[0];
    if (typeof targetTableId !== 'string' || !isUuid(targetTableId)) {
      throw new WorkbenchValidationError(`汇总字段「${f.name}」的关联目标表不可解析`);
    }
    const targetTable = await getTable(orgId, memberId, targetTableId);
    if (!targetTable) {
      throw new WorkbenchValidationError(`汇总字段「${f.name}」的关联目标表不可用或不可见`);
    }

    // ③ fn 白名单（rollup）
    const fn = isLookup ? 'lookup' : opts[2];
    if (isRollup && !ROLLUP_AGGREGATE_FNS.includes(String(fn))) {
      throw new WorkbenchValidationError(
        `汇总字段「${f.name}」的聚合函数「${String(fn)}」不支持：只允许 count/sum/min/max/concat`
      );
    }

    // ④ 类型×函数
    const targetFieldId = opts[1];
    if (isRollup && fn === 'count') {
      // count 只数关联行数，不需要目标字段
      continue;
    }
    const targetField = targetTable.fields.find((x) => x.field_id === targetFieldId);
    if (!targetField) {
      throw new WorkbenchValidationError(
        `汇总字段「${f.name}」的目标字段无效：必须选关联目标表的一个已有字段`
      );
    }
    if (isRollup && (fn === 'sum' || fn === 'min' || fn === 'max')) {
      if (targetField.field_type !== 'number') {
        throw new WorkbenchValidationError(
          `汇总字段「${f.name}」的聚合函数与字段类型不匹配：${String(fn)} 只能用于数值字段`
        );
      }
    }
    // concat / lookup：目标字段任意类型，已确认存在即可
  }
}

export async function listFields(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<FieldOut[] | null> {
  const t = await getTable(orgId, memberId, tableId);
  if (!t) return null;
  return t.fields;
}

/** 给已有表加字段。表不可见时返 null（同 404 口径），不透露它存在。 */
export async function addFields(
  orgId: string,
  memberId: string,
  tableId: string,
  raw: unknown
): Promise<FieldOut[] | null> {
  const t = await getTable(orgId, memberId, tableId);
  if (!t) return null;
  const incoming = normalizeFields(raw);
  if (incoming.length === 0) throw new WorkbenchValidationError('fields 不能为空');
  // relation 字段的目标表必须本组织可见（A27①/A31① 写入侧校验），不可解析即整笔拒绝
  await assertRelationTargetsVisible(orgId, memberId, incoming);
  // rollup/lookup 字段的类型×函数校验（A40）：关联字段是本表活字段 + 目标表可见 + fn 白名单 +
  // sum/min/max 只允 number。不过即抛 400，绝不放行成读时静默 NaN。
  await assertRollupConfigValid(orgId, memberId, t.fields, incoming);
  let nextOrder = t.fields.length;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertFields(
      client,
      tableId,
      orgId,
      incoming.map((f) => ({ ...f, display_order: f.display_order ?? nextOrder++ }))
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return listFieldRows(tableId, orgId);
}

export type DeleteOutcome =
  | { kind: 'not_found' }
  | { kind: 'confirm_mismatch' }
  | { kind: 'deleted'; tableId: string; deletedAt: string };

/**
 * 软删。二次确认名与表名逐字不等 → 一个字节都不改（不打 deleted_at、不写审计）。
 * 名字对上 → 只 UPDATE deleted_at，db_tables 与 db_fields 的物理行一条不少。
 */
export async function softDeleteTable(
  orgId: string,
  memberId: string,
  tableId: string,
  confirmName: unknown
): Promise<DeleteOutcome> {
  const t = await getTable(orgId, memberId, tableId);
  if (!t) return { kind: 'not_found' };
  if (typeof confirmName !== 'string' || confirmName !== t.name) return { kind: 'confirm_mismatch' };

  const r = await pool.query(
    `UPDATE zenithjoy.db_tables SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
      RETURNING deleted_at`,
    [tableId, orgId]
  );
  if (r.rowCount === 0) return { kind: 'not_found' };
  await pool
    .query(
      `INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
       VALUES ($1, $2, $3, 'soft_delete_table', '{}'::jsonb)`,
      [orgId, tableId, memberId]
    )
    .catch(() => undefined);
  return { kind: 'deleted', tableId, deletedAt: new Date(r.rows[0].deleted_at).toISOString() };
}

/** 回收站：本组织里自己看得见的、已软删且仍在 30 天窗口内的表。 */
export async function listTrash(orgId: string, memberId: string): Promise<TrashEntry[]> {
  const r = await pool.query(
    `SELECT id, name, deleted_at,
            deleted_at + make_interval(days => $3) AS restorable_until
       FROM zenithjoy.db_tables
      WHERE org_id = $1
        AND deleted_at IS NOT NULL
        AND (visibility = 'org' OR owner_member_id = $2)
      ORDER BY deleted_at DESC`,
    [orgId, memberId, TRASH_RETENTION_DAYS]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    table_id: String(row.id),
    name: String(row.name),
    deleted_at: new Date(row.deleted_at as string).toISOString(),
    restorable_until: new Date(row.restorable_until as string).toISOString(),
  }));
}

/** 还原：deleted_at 回 NULL。字段定义从未被删过，所以"逐字回归"是软删的自然结果而非补偿逻辑。 */
export async function restoreTable(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<{ table_id: string; restored_at: string } | null> {
  if (!isUuid(tableId)) return null;
  const r = await pool.query(
    `UPDATE zenithjoy.db_tables SET deleted_at = NULL, updated_at = NOW()
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NOT NULL
        AND (visibility = 'org' OR owner_member_id = $3)
      RETURNING updated_at`,
    [tableId, orgId, memberId]
  );
  if (r.rowCount === 0) return null;
  await pool
    .query(
      `INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
       VALUES ($1, $2, $3, 'restore_table', '{}'::jsonb)`,
      [orgId, tableId, memberId]
    )
    .catch(() => undefined);
  return { table_id: tableId, restored_at: new Date(r.rows[0].updated_at).toISOString() };
}

export type DeleteFieldOutcome =
  | { kind: 'not_found' }
  | { kind: 'confirm_mismatch' }
  | { kind: 'deleted'; fieldId: string; deletedAt: string };

/**
 * 软删字段（A30③）。二次确认名与字段名逐字不等 → 一个字节都不改（不打 deleted_at）。
 * 名字对上 → 只 UPDATE db_fields.deleted_at，物理行保留、db_rows.data 里旧关联值一条不动。
 * 表不可见 / 字段不属该表 / 已软删 → not_found（同 404 口径，不透露存在性）。
 */
export async function softDeleteField(
  orgId: string,
  memberId: string,
  tableId: string,
  fieldId: string,
  confirmName: unknown
): Promise<DeleteFieldOutcome> {
  const t = await getTable(orgId, memberId, tableId);
  if (!t) return { kind: 'not_found' };
  if (!isUuid(fieldId)) return { kind: 'not_found' };
  const f = await pool.query(
    `SELECT id, name FROM zenithjoy.db_fields
      WHERE id = $1 AND table_id = $2 AND org_id = $3 AND deleted_at IS NULL`,
    [fieldId, tableId, orgId]
  );
  if (f.rowCount === 0) return { kind: 'not_found' };
  if (typeof confirmName !== 'string' || confirmName !== String(f.rows[0].name)) {
    return { kind: 'confirm_mismatch' };
  }
  const r = await pool.query(
    `UPDATE zenithjoy.db_fields SET deleted_at = NOW()
      WHERE id = $1 AND table_id = $2 AND org_id = $3 AND deleted_at IS NULL
      RETURNING deleted_at`,
    [fieldId, tableId, orgId]
  );
  if (r.rowCount === 0) return { kind: 'not_found' };
  await pool
    .query(
      `INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
       VALUES ($1, $2, $3, 'soft_delete_field', '{}'::jsonb)`,
      [orgId, tableId, memberId]
    )
    .catch(() => undefined);
  return { kind: 'deleted', fieldId, deletedAt: new Date(r.rows[0].deleted_at).toISOString() };
}

/** 非 uuid 的路径参数直接当"不存在"，别让它走到 SQL 那里抛 22P02 变成 500。 */
export function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}
