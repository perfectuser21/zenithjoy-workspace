/**
 * 路③ 结构化工作台 · 行 service —— db_rows 的读写（Sprint B / S2「数据进得来」）
 *
 * 承接 Sprint A 的三条纪律，一条不改：
 *  1. **组织归属只来自入参 orgId**（由 workbenchAuthGuard 从会话解析）。本文件不认识请求体，
 *     也不认识任何请求头。每条 SQL 自带 `org_id` 条件是纵深防御：将来多一个调用方忘了先查表，
 *     这里仍然漏不出去。
 *  2. **零运行时 DDL**：单元格值一律作为 JSONB 数据值落 `db_rows.data`，key 是稳定的
 *     `db_fields.id`（不是字段名、不是列序号）。用户输入永不进 SQL 标识符位。
 *  3. **软删**：删行只打 `deleted_at`，物理行一条不少，30 天内可原样还原。
 *
 * 本刀新增的第四条：**行级 `version` 乐观锁**（上位合同 J2）。写回一律带基线 version，
 * 带条件 UPDATE 的 rowCount 就是「有没有发生并发冲突」的判据 —— 用 `updated_at` 时间戳
 * 分辨不出同秒内的两次提交，那正是「员工发现自己刚打的内容凭空消失」的入口。
 *
 * 错误判定顺序固定 **404 → 400 → 409**：不可达/不存在（行不存在、跨组织、行已软删、
 * 表已软删）先于任何校验与版本比较返回同形 404；通过存在性与权限后才做类型校验（400），
 * 最后才比对 version（409）。顺序反了会让「他企业有没有这一行」从错误码里漏出去。
 */
import type { Pool, PoolClient } from 'pg';
import pool from '../db/connection';
import {
  TRASH_RETENTION_DAYS,
  WorkbenchValidationError,
  isUuid,
  listFieldRows,
  type FieldOut,
} from './workbench.service';

/** 单表行数上限的缺省值（合同 J12 的产品阈值）。CI 用小值证明闸在，默认值住在这里。 */
export const DEFAULT_ROW_LIMIT = 5000;

type Queryable = Pool | PoolClient;

export interface RowOut {
  row_id: string;
  data: Record<string, unknown>;
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

export interface PasteResult {
  inserted: number;
  created_fields: Array<{ field_id: string; name: string; field_type: string }>;
  row_ids: string[];
}

export interface TableExport {
  table_id: string;
  name: string;
  fields: FieldOut[];
  rows: RowOut[];
  exported_at: string;
}

/** 行数超上限：与「值不合法」是两件事，错误码不同（前端提示也不同），所以单开一个类型。 */
export class RowLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RowLimitError';
  }
}

/** 版本不匹配：库中该格一个字节不改，前端拿它进冲突态。 */
export class RowVersionConflictError extends Error {
  constructor() {
    super('该行已被他人修改，你的改动未保存');
    this.name = 'RowVersionConflictError';
  }
}

/**
 * 单表行数上限 —— **每请求**从 env 解析，禁止在模块加载期固化成常量。
 *
 * 固化成常量的话，CI 里把 `WORKBENCH_ROW_LIMIT` 覆写成小值来证明闸真的在这件事就做不到了
 * （进程已经把 5000 读进内存了），于是「闸存在」这条永远只能靠真插 5000 行来验，
 * 而那会把 windows job 的预算烧光 —— 结果就是这条闸根本没人验。
 */
export function resolveRowLimit(): number {
  const raw = process.env.WORKBENCH_ROW_LIMIT;
  const n = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ROW_LIMIT;
}

/**
 * 上限判定的唯一出口。抽成函数不是为了复用那一行算术，是为了给变异证明一个确定的注入点：
 * `A15-limit-off` 把它改成恒 false，超限批次就会落库，`--a15-only` 必须当场报红。
 */
export function exceedsRowLimit(total: number, incoming: number, limit: number): boolean {
  return total + incoming > limit;
}

function toRowOut(r: Record<string, unknown>): RowOut {
  return {
    row_id: String(r.id),
    data: (r.data ?? {}) as Record<string, unknown>,
    version: Number(r.version),
    row_order: Number(r.row_order),
    created_at: new Date(r.created_at as string).toISOString(),
    updated_at: new Date(r.updated_at as string).toISOString(),
  };
}

const ROW_COLUMNS = 'r.id, r.data, r.version, r.row_order, r.created_at, r.updated_at';

/**
 * 表可达性判定。跨组织 / 他人的 private 表 / 已软删的表 / 压根不存在 —— 四种情形一律返 null，
 * 由路由翻成同一个 404 体。区分它们就是给攻击者发枚举工具。
 */
async function resolveTable(
  db: Queryable,
  tableId: string,
  orgId: string,
  memberId: string
): Promise<{ id: string; name: string } | null> {
  if (!isUuid(tableId)) return null;
  const t = await db.query(
    `SELECT t.id, t.name
       FROM zenithjoy.db_tables t
      WHERE t.id = $1 AND t.org_id = $2 AND t.deleted_at IS NULL
        AND (t.visibility = 'org' OR t.owner_member_id = $3)`,
    [tableId, orgId, memberId]
  );
  if (t.rowCount === 0) return null;
  return { id: String(t.rows[0].id), name: String(t.rows[0].name) };
}

/** 行可达性判定：行归属 + 所在表可达，两者缺一即 null（软删与否由调用方按语义再判）。 */
async function resolveRow(
  db: Queryable,
  rowId: string,
  orgId: string,
  memberId: string
): Promise<(RowOut & { table_id: string; deleted_at: string | null }) | null> {
  if (!isUuid(rowId)) return null;
  const r = await db.query(
    `SELECT ${ROW_COLUMNS}, r.table_id, r.deleted_at
       FROM zenithjoy.db_rows r
       JOIN zenithjoy.db_tables t ON t.id = r.table_id AND t.org_id = $2
      WHERE r.id = $1 AND r.org_id = $2 AND t.deleted_at IS NULL
        AND (t.visibility = 'org' OR t.owner_member_id = $3)`,
    [rowId, orgId, memberId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    ...toRowOut(row),
    table_id: String(row.table_id),
    deleted_at: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
  };
}

async function countLiveRows(db: Queryable, tableId: string, orgId: string): Promise<number> {
  const c = await db.query(
    `SELECT count(*)::int AS n FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL`,
    [tableId, orgId]
  );
  return Number(c.rows[0].n);
}

/**
 * 事务外的审计写入失败**不许把一次已经落库的写变成 5xx**：客户端看到 503 会重发，
 * 于是多出一行/多写一次。审计断链只打日志（DoD 那条「四种动作全部落 db_audit」会在 CI 抓住它），
 * 不牵连业务写。事务内的调用（粘贴）不走这条：那里失败本就该整批回滚。
 */
function auditBestEffort(p: Promise<void>, scope: string): Promise<void> {
  return p.catch((err) => {
    console.error(`[workbench] ${scope} 审计写入失败:`, (err as Error).message);
  });
}

async function writeAudit(
  db: Queryable,
  orgId: string,
  tableId: string,
  memberId: string,
  action: string,
  detail: Record<string, unknown>
): Promise<void> {
  // INV-5 日志脱敏同口径：审计只记 id 与动作，不记单元格正文
  await db.query(
    `INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orgId, tableId, memberId, action, JSON.stringify(detail)]
  );
}

// ── 值校验（合同「字段类型校验表」逐行对应；null 一律合法 = 清空该格）────────────────

const DATE_LITERAL = /^\d{4}-\d{2}-\d{2}$/;

function cellTypeError(field: FieldOut, value: unknown): string | null {
  if (value === null) return null;
  const label = `字段「${field.name}」`;
  switch (field.field_type) {
    case 'text':
    case 'long_text':
      return typeof value === 'string' ? null : `${label}只接受文本`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${label}只接受数字`;
    case 'date':
      return typeof value === 'string' && DATE_LITERAL.test(value)
        ? null
        : `${label}只接受 YYYY-MM-DD 形式的日期`;
    case 'single_select':
      return typeof value === 'string' && field.options.includes(value)
        ? null
        : `${label}的值不在可选项内`;
    case 'multi_select':
      return Array.isArray(value) && value.every((v) => typeof v === 'string' && field.options.includes(v))
        ? null
        : `${label}的值不在可选项内`;
    case 'person':
      return typeof value === 'string' && value.length > 0 ? null : `${label}只接受成员标识`;
    case 'url':
      return typeof value === 'string' && /^https?:\/\//.test(value)
        ? null
        : `${label}只接受 http:// 或 https:// 开头的链接`;
    case 'relation':
      // 结构校验：必须是**目标 row_id 数组**，每个元素是合法 uuid。用户输入永不进标识符位——
      // SQL 片段/非 uuid 在这里就被挡回 400（P2 注入对抗面），不会走到深校验的绑定参数上。
      // 元素是否指向**本组织可见的目标记录**由 patchRow 的异步深校验（validateRelationTargets）二次判。
      return Array.isArray(value) && value.every((v) => typeof v === 'string' && isUuid(v))
        ? null
        : `${label}只接受目标记录 id 数组`;
    default:
      return `${label}的类型未登记`;
  }
}

/**
 * relation 值的深校验（A27②/A31 写入侧）：每个目标 row_id 必须是关联字段目标表
 * （field.options[0]）里**本组织、未软删**的记录。目标 id 全程走绑定参数当数据值，
 * 永不拼进 SQL 标识符位。任一不可见 → 抛校验失败（路由翻 400，行 version 不变）。
 */
async function validateRelationTargets(
  db: Queryable,
  orgId: string,
  memberId: string,
  fields: FieldOut[],
  sets: Record<string, unknown>
): Promise<void> {
  for (const field of fields) {
    if (field.field_type !== 'relation') continue;
    if (!(field.field_id in sets)) continue;
    const ids = sets[field.field_id];
    if (!Array.isArray(ids)) continue; // 结构已由 cellTypeError 保证是 uuid 数组
    const targetTableId = field.options[0];
    if (typeof targetTableId !== 'string' || !isUuid(targetTableId)) {
      throw new WorkbenchValidationError(`关联字段「${field.name}」的目标表配置无效`);
    }
    // 目标表必须本组织可见（跨企业/私有非表主/已删 → 不可解析）
    const target = await resolveTable(db, targetTableId, orgId, memberId);
    if (!target) throw new WorkbenchValidationError(`关联字段「${field.name}」的目标表不可用`);
    for (const id of ids as string[]) {
      const r = await db.query(
        `SELECT 1 FROM zenithjoy.db_rows r
          WHERE r.id = $1 AND r.org_id = $2 AND r.table_id = $3 AND r.deleted_at IS NULL`,
        [id, orgId, targetTableId]
      );
      if (r.rowCount === 0) {
        throw new WorkbenchValidationError(`关联字段「${field.name}」指向不可见或不存在的记录`);
      }
    }
  }
}

/** 增量补丁校验：field_id 必须属于该表，值必须与字段类型相符。任一不符即整笔拒绝。 */
function validatePatch(
  patch: Record<string, unknown>,
  fields: FieldOut[]
): { clears: string[]; sets: Record<string, unknown> } {
  // 用 Map 而不是对象字面量：field_id 虽是 uuid，但同样的写法在下面粘贴那段要吃用户给的列名，
  // 两处口径保持一致，`__proto__` / `constructor` 这类名字永远进不了原型链。
  const byId = new Map(fields.map((f) => [f.field_id, f]));
  const clears: string[] = [];
  const sets: Record<string, unknown> = Object.create(null);
  for (const [fieldId, value] of Object.entries(patch)) {
    const field = byId.get(fieldId);
    if (!field) throw new WorkbenchValidationError(`字段不存在或不属于该表：${fieldId}`);
    const err = cellTypeError(field, value);
    if (err) throw new WorkbenchValidationError(err);
    if (value === null) clears.push(fieldId);
    else sets[fieldId] = value;
  }
  return { clears, sets };
}

// ── 读 ──────────────────────────────────────────────────────────────────────

/** filter 白名单 op（合同 Response Schema）。落比较运算符选择，非白名单一律 400。 */
const FILTER_OPS = ['contains', 'equals', 'gt', 'lt'] as const;
/** sort 白名单 dir。直接落 `ORDER BY … ASC|DESC` 关键字位，坏 dir 一律 400（不是拼进 SQL）。 */
const SORT_DIRS = ['asc', 'desc'] as const;

interface ParsedFilter {
  field_id: string;
  op: string;
  value: string;
}
interface ParsedSort {
  field_id: string;
  dir: string;
  field_type: string;
}

/** 参数是 URL-encoded JSON 数组。解析不出 JSON / 不是数组一律 400 VALIDATION_FAILED。 */
function parseQueryArray(raw: unknown, kind: string): unknown[] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new WorkbenchValidationError(`${kind} 参数形态非法`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WorkbenchValidationError(`${kind} 参数不是合法 JSON`);
  }
  if (!Array.isArray(parsed)) throw new WorkbenchValidationError(`${kind} 参数必须是数组`);
  return parsed;
}

/**
 * field_id 白名单映射 —— 用户输入永不进标识符位（上位合同 A25）。
 * 死顺序 404 优先于 400：field_id 是合法 UUID 但不属本表（含他企业真实 field_id）→ 抛 CrossTable 触发 404；
 * 非 UUID 形态（含原始 SQL 片段）→ 400（它永远不可能是本表某字段，不牵涉存在性泄露）。
 */
class CrossTableFieldError extends Error {
  constructor() {
    super('字段不存在或不属于该表');
    this.name = 'CrossTableFieldError';
  }
}

function whitelistField(fieldId: unknown, fieldMap: Map<string, FieldOut>): FieldOut {
  if (typeof fieldId !== 'string' || fieldId.length === 0) {
    throw new WorkbenchValidationError('field_id 必填');
  }
  if (!isUuid(fieldId)) throw new WorkbenchValidationError('field_id 形态非法');
  const known = fieldMap.get(fieldId);
  const fallback: FieldOut = { field_id: fieldId, name: '', field_type: 'text', options: [], display_order: 0 };
  const belongs = known !== undefined;
  if (!belongs) throw new CrossTableFieldError();
  return known ?? fallback;
}

function normalizeQueryFilters(raw: unknown[], fieldMap: Map<string, FieldOut>): ParsedFilter[] {
  return raw.map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    whitelistField(f.field_id, fieldMap);
    const op = typeof f.op === 'string' ? f.op : '';
    if (!(FILTER_OPS as readonly string[]).includes(op)) {
      throw new WorkbenchValidationError('filter.op 不在白名单内');
    }
    return { field_id: String(f.field_id), op, value: f.value === null || f.value === undefined ? '' : String(f.value) };
  });
}

function normalizeQuerySorts(raw: unknown[], fieldMap: Map<string, FieldOut>): ParsedSort[] {
  return raw.map((item) => {
    const s = (item ?? {}) as Record<string, unknown>;
    const field = whitelistField(s.field_id, fieldMap);
    const dir = typeof s.dir === 'string' ? s.dir : '';
    if (!(SORT_DIRS as readonly string[]).includes(dir)) {
      throw new WorkbenchValidationError('sort.dir 不在白名单内');
    }
    return { field_id: String(s.field_id), dir, field_type: field.field_type };
  });
}

export async function listRows(
  orgId: string,
  memberId: string,
  tableId: string,
  query: { filter?: unknown; sort?: unknown } = {}
): Promise<{ rows: RowOut[]; total: number; row_limit: number } | null> {
  // 404 优先于 400：表不可达先于任何参数校验（顺序反了会让「他企业有没有这表」从错误码里漏出去）
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;

  const rawFilters = parseQueryArray(query.filter, 'filter');
  const rawSorts = parseQueryArray(query.sort, 'sort');

  // 无参数时逐字等于 Sprint B 的返回（响应体形状一字不改）
  if (rawFilters === undefined && rawSorts === undefined) {
    const r = await pool.query(
      `SELECT ${ROW_COLUMNS}
         FROM zenithjoy.db_rows r
        WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL
        ORDER BY r.row_order ASC, r.created_at ASC`,
      [tableId, orgId]
    );
    const rows = r.rows.map(toRowOut);
    return { rows, total: rows.length, row_limit: resolveRowLimit() };
  }

  const fieldMap = new Map((await listFieldRows(tableId, orgId)).map((f) => [f.field_id, f]));
  const filters = rawFilters ? normalizeQueryFilters(rawFilters, fieldMap) : [];
  const sorts = rawSorts ? normalizeQuerySorts(rawSorts, fieldMap) : [];

  // field_id 走绑定参数当 JSONB 键，dir/cast 由代码按白名单选定——用户输入永不进标识符位
  const params: unknown[] = [tableId, orgId];
  const whereParts: string[] = [];
  for (const f of filters) {
    const keyIdx = params.push(f.field_id);
    const valIdx = params.push(f.value);
    switch (f.op) {
      case 'contains':
        whereParts.push(`strpos(COALESCE(r.data ->> $${keyIdx}, ''), $${valIdx}) > 0`);
        break;
      case 'equals':
        whereParts.push(`COALESCE(r.data ->> $${keyIdx}, '') = $${valIdx}`);
        break;
      case 'gt':
        whereParts.push(`(r.data ->> $${keyIdx})::numeric > ($${valIdx})::numeric`);
        break;
      case 'lt':
        whereParts.push(`(r.data ->> $${keyIdx})::numeric < ($${valIdx})::numeric`);
        break;
    }
  }

  let orderClause = 'ORDER BY r.row_order ASC, r.created_at ASC';
  if (sorts.length > 0) {
    const parts = sorts.map((s) => {
      const keyIdx = params.push(s.field_id);
      const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
      // 数字字段按数值序（字典序会把 10 排到 9 前），其余按文本序
      const expr =
        s.field_type === 'number'
          ? `NULLIF(r.data ->> $${keyIdx}, '')::numeric`
          : `r.data ->> $${keyIdx}`;
      return `${expr} ${dir} NULLS LAST`;
    });
    orderClause = `ORDER BY ${parts.join(', ')}, r.row_order ASC`;
  }

  const whereSql = whereParts.length > 0 ? ` AND ${whereParts.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT ${ROW_COLUMNS}
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL${whereSql}
      ${orderClause}`,
    params
  );
  const rows = r.rows.map(toRowOut);
  return { rows, total: rows.length, row_limit: resolveRowLimit() };
}

/** 路由据它把跨表 field_id 翻成 404（与表不可达同一个 notFoundBody）。 */
export function isCrossTableFieldError(err: unknown): boolean {
  return err instanceof CrossTableFieldError;
}

export async function listRowTrash(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<RowTrashEntry[] | null> {
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;
  const r = await pool.query(
    `SELECT r.id, r.deleted_at,
            r.deleted_at + make_interval(days => $3) AS restorable_until
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NOT NULL
      ORDER BY r.deleted_at DESC`,
    [tableId, orgId, TRASH_RETENTION_DAYS]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    row_id: String(row.id),
    deleted_at: new Date(row.deleted_at as string).toISOString(),
    restorable_until: new Date(row.restorable_until as string).toISOString(),
  }));
}

export async function exportTable(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<TableExport | null> {
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;
  const fields = await listFieldRows(tableId, orgId);
  const r = await pool.query(
    `SELECT ${ROW_COLUMNS}
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL
      ORDER BY r.row_order ASC, r.created_at ASC`,
    [tableId, orgId]
  );
  // 导出体里**没有** org_id：它对使用者零价值，却是「导出体里有没有他组织痕迹」这条判据
  // 最容易被污染的入口（一旦带上自家 org_id，跨组织 grep 断言就退化成看运气）。
  return {
    table_id: table.id,
    name: table.name,
    fields,
    rows: r.rows.map(toRowOut),
    exported_at: new Date().toISOString(),
  };
}

// ── 写 ──────────────────────────────────────────────────────────────────────

export async function createRow(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<RowOut | null> {
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;

  const limit = resolveRowLimit();
  const total = await countLiveRows(pool, tableId, orgId);
  if (exceedsRowLimit(total, 1, limit)) {
    throw new RowLimitError(`已有 ${total} 行，超过单表上限 ${limit} 行，未新增`);
  }

  const r = await pool.query(
    `INSERT INTO zenithjoy.db_rows (table_id, org_id, data, row_order, created_by)
     SELECT $1, $2, '{}'::jsonb, COALESCE(MAX(r.row_order), -1) + 1, $3
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2
     RETURNING id, data, version, row_order, created_at, updated_at`,
    [tableId, orgId, memberId]
  );
  const row = toRowOut(r.rows[0]);
  await auditBestEffort(
    writeAudit(pool, orgId, tableId, memberId, 'create_row', { row_id: row.row_id }),
    'create_row'
  );
  return row;
}

/**
 * 行内改格。`data` 是**增量补丁**，只含被改的格；返回的是合并后的整行与递增后的 version ——
 * 前端拿它回填（而不是拿本地乐观值，也不是整表重拉），这是「写回到底成没成功」的判定点。
 */
export async function patchRow(
  orgId: string,
  memberId: string,
  rowId: string,
  rawVersion: unknown,
  rawData: unknown
): Promise<RowOut | null> {
  // ① 404 优先：不可达/不存在/已软删，先于任何校验与版本比较
  const current = await resolveRow(pool, rowId, orgId, memberId);
  if (!current || current.deleted_at !== null) return null;

  // ② 400：基线 version 缺失或非整数 —— 缺了就当放行等于把乐观锁关掉
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 0) {
    throw new WorkbenchValidationError('缺少合法的基线 version');
  }
  if (rawData !== undefined && rawData !== null && (typeof rawData !== 'object' || Array.isArray(rawData))) {
    throw new WorkbenchValidationError('data 必须是对象');
  }
  const patch = (rawData ?? {}) as Record<string, unknown>;

  const fields = await listFieldRows(current.table_id, orgId);
  const { clears, sets } = validatePatch(patch, fields);
  // relation 值深校验：结构（uuid 数组）已由 validatePatch→cellTypeError 挡过，这里再验
  // 每个目标 row_id 是否本组织可见（A27②/A31 写入侧）。不可见即整笔拒绝，行 version 不变。
  await validateRelationTargets(pool, orgId, memberId, fields, sets);

  // 空补丁是合法的无副作用空写：不改任何格，version 也不递增
  if (clears.length === 0 && Object.keys(sets).length === 0) {
    return {
      row_id: current.row_id,
      data: current.data,
      version: current.version,
      row_order: current.row_order,
      created_at: current.created_at,
      updated_at: current.updated_at,
    };
  }

  // ③ 409：带条件 UPDATE 的 rowCount 就是冲突判据。合并在 SQL 里做，
  //    避免「先读后写」那段窗口期里别人提交了我们却拿旧快照覆盖回去。
  const r = await pool.query(
    `UPDATE zenithjoy.db_rows r
        SET data = (r.data || $3::jsonb) - $4::text[],
            version = r.version + 1,
            updated_at = NOW()
      WHERE r.id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL AND r.version = $5
      RETURNING ${ROW_COLUMNS}`,
    [rowId, orgId, JSON.stringify(sets), clears, rawVersion]
  );
  if (r.rowCount === 0) throw new RowVersionConflictError();

  const row = toRowOut(r.rows[0]);
  await auditBestEffort(
    writeAudit(pool, orgId, current.table_id, memberId, 'update_row', {
      row_id: row.row_id,
      // 只记被改了几个格，不记 field_id 更不记正文
      changed: clears.length + Object.keys(sets).length,
    }),
    'update_row'
  );
  return row;
}

export async function softDeleteRow(
  orgId: string,
  memberId: string,
  rowId: string
): Promise<{ row_id: string; deleted_at: string } | null> {
  const current = await resolveRow(pool, rowId, orgId, memberId);
  if (!current || current.deleted_at !== null) return null;

  const r = await pool.query(
    `UPDATE zenithjoy.db_rows r SET deleted_at = NOW(), updated_at = NOW()
      WHERE r.id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL
      RETURNING r.deleted_at`,
    [rowId, orgId]
  );
  if (r.rowCount === 0 || !r.rows[0].deleted_at) return null;
  const deletedAt = new Date(r.rows[0].deleted_at as string).toISOString();
  await auditBestEffort(
    writeAudit(pool, orgId, current.table_id, memberId, 'soft_delete_row', { row_id: rowId }),
    'soft_delete_row'
  );
  return { row_id: rowId, deleted_at: deletedAt };
}

/** 还原：`deleted_at` 回 NULL。`data` 从未被删过，所以"逐字回归"是软删的自然结果而非补偿逻辑。 */
export async function restoreRow(
  orgId: string,
  memberId: string,
  rowId: string
): Promise<RowOut | null> {
  const current = await resolveRow(pool, rowId, orgId, memberId);
  if (!current || current.deleted_at === null) return null;

  const r = await pool.query(
    `UPDATE zenithjoy.db_rows r SET deleted_at = NULL, updated_at = NOW()
      WHERE r.id = $1 AND r.org_id = $2 AND r.deleted_at IS NOT NULL
      RETURNING ${ROW_COLUMNS}`,
    [rowId, orgId]
  );
  if (r.rowCount === 0) return null;
  await auditBestEffort(
    writeAudit(pool, orgId, current.table_id, memberId, 'restore_row', { row_id: rowId }),
    'restore_row'
  );
  return toRowOut(r.rows[0]);
}

/**
 * 剪贴板粘贴批量导入。
 *
 * 列名与现有 `db_fields.name` **逐字相等**才复用（上位合同判定点：模糊匹配会把「金额」
 * 并进「金额(元)」造成数据错列，而字段类型创建后不可变，错了只能删列重来）；
 * 未匹配的列一律新建 `text` 类型（J9：不做类型推断，推错当场丢数据）。
 *
 * 超上限**整批拒绝**（J12）：截断或"落到哪算哪"都是静默丢行 —— 最难发现的一类数据事故。
 * 整段在一个事务里，拒绝时零新增行、零新建字段。
 */
export async function pasteRows(
  orgId: string,
  memberId: string,
  tableId: string,
  rawHeader: unknown,
  rawRows: unknown
): Promise<PasteResult | null> {
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;

  if (!Array.isArray(rawHeader) || rawHeader.length === 0) {
    throw new WorkbenchValidationError('header 必须是非空数组');
  }
  const header = rawHeader.map((h) => String(h));
  if (!Array.isArray(rawRows)) throw new WorkbenchValidationError('rows 必须是数组');
  const rows = rawRows.map((row, idx) => {
    if (!Array.isArray(row)) throw new WorkbenchValidationError(`第 ${idx + 1} 行不是数组`);
    return row;
  });

  const limit = resolveRowLimit();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const total = await countLiveRows(client, tableId, orgId);
    if (exceedsRowLimit(total, rows.length, limit)) {
      await client.query('ROLLBACK');
      throw new RowLimitError(
        `已有 ${total} 行，本次粘贴 ${rows.length} 行，超过单表上限 ${limit} 行，整批未导入`
      );
    }

    const existing = await listFieldRows(tableId, orgId, client);
    // 列名是用户给的，`__proto__` / `constructor` 都可能出现 —— 用 Map 存，永远进不了原型链
    const byName = new Map(existing.map((f) => [f.name, f]));
    let nextOrder = existing.length;
    const createdFields: PasteResult['created_fields'] = [];
    const columnFieldIds: string[] = [];

    for (const name of header) {
      const hit = byName.get(name);
      if (hit) {
        columnFieldIds.push(hit.field_id);
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO zenithjoy.db_fields (table_id, org_id, name, field_type, options, display_order)
         VALUES ($1, $2, $3, 'text', '[]'::jsonb, $4)
         RETURNING id, name, field_type`,
        [tableId, orgId, name, nextOrder]
      );
      nextOrder += 1;
      const f = inserted.rows[0];
      const fieldId = String(f.id);
      createdFields.push({ field_id: fieldId, name: String(f.name), field_type: String(f.field_type) });
      byName.set(name, {
        field_id: fieldId,
        name: String(f.name),
        field_type: String(f.field_type),
        options: [],
        display_order: nextOrder - 1,
      });
      columnFieldIds.push(fieldId);
    }

    const orderBase = await client.query(
      `SELECT COALESCE(MAX(r.row_order), -1) + 1 AS next FROM zenithjoy.db_rows r
        WHERE r.table_id = $1 AND r.org_id = $2`,
      [tableId, orgId]
    );
    let order = Number(orderBase.rows[0].next);

    const rowIds: string[] = [];
    for (const cells of rows) {
      const data: Record<string, unknown> = Object.create(null);
      columnFieldIds.forEach((fieldId, i) => {
        if (i >= cells.length) return;
        const v = cells[i];
        if (v === undefined || v === null) return;
        // 粘贴来的都是文本（J9 不做类型推断），原样作为数据值存进 JSONB
        data[fieldId] = String(v);
      });
      const r = await client.query(
        `INSERT INTO zenithjoy.db_rows (table_id, org_id, data, row_order, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id`,
        [tableId, orgId, JSON.stringify(data), order, memberId]
      );
      order += 1;
      rowIds.push(String(r.rows[0].id));
    }

    await writeAudit(client, orgId, tableId, memberId, 'paste_rows', {
      inserted: rowIds.length,
      created_fields: createdFields.length,
    });
    await client.query('COMMIT');
    return { inserted: rowIds.length, created_fields: createdFields, row_ids: rowIds };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
