/**
 * 路③ 结构化工作台 · 视图 service —— db_view_prefs 的读写（Sprint C / S3「视图切得开」）
 *
 * controller concern C1：视图 = zenithjoy.db_view_prefs 的一行，**零新增 migration、不另建视图表**。
 * 视图体（view_type / filters / sorts / group_field_id / hidden_field_ids / is_active）装在 prefs JSONB 里，
 * 三键（org_id / table_id / member_id）是 db_view_prefs 的物理列。
 *
 * 承接 Sprint A/B 的纪律，一条不改：
 *  1. **组织归属只来自入参 orgId / memberId**（由 workbenchAuthGuard 从会话解析）。本文件不认识
 *     请求体，也不认识任何请求头——请求体里的 org_id / member_id / tenant_id 连读都不读。
 *  2. **用户输入永不进 SQL 标识符位**：group_field_id / sort / filter 一律先在本表字段集里查白名单，
 *     再作为绑定参数当数据值使用。
 *  3. **反枚举**：跨组织 / 他人的视图 / 压根不存在的 view_id / 不属本表的 field_id —— 一律返 null，
 *     由路由翻成同一个 404 体（notFoundBody，不带 timestamp）。
 *
 * 死顺序 **404 → 400**：表不可达 → 视图不可达 → field_id 不属本表（404）→ 才轮到形状/类型校验（400）。
 * 顺序反了会让「他企业有没有这个视图 / 这个字段」从错误码里漏出去。
 *
 * 读路径降级（A22 分支①）：视图引用的字段被删后，读出来时把失效引用剔除、group_field_id 置 null、
 * degraded 置 true —— **只改读出来的东西，库里那行原样保留**（前端据 degraded 出可见提示）。
 */
import type { Pool, PoolClient } from 'pg';
import pool from '../db/connection';
import { WorkbenchValidationError, isUuid, listFieldRows, type FieldOut } from './workbench.service';

type Queryable = Pool | PoolClient;

/** 分组字段类型不是 single_select（controller concern C2）：与「值不合法」分开的错误码。 */
export class GroupFieldTypeError extends Error {
  constructor() {
    super('分组列只能选单选字段');
    this.name = 'GroupFieldTypeError';
  }
}

/** 删到最后一个视图：至少保留一个，员工不能把自己删到没有任何视图。 */
export class LastViewProtectedError extends Error {
  constructor() {
    super('至少保留一个视图，删到最后一个被拒');
    this.name = 'LastViewProtectedError';
  }
}

/** field_id 合法 UUID 但不属本表（含他企业真实 field_id）—— 用它触发 404（不是 400，不泄露存在性差异）。 */
class FieldNotFoundError extends Error {
  constructor() {
    super('字段不存在或不属于该表');
    this.name = 'FieldNotFoundError';
  }
}

/** 路由据它把不属本表的 field_id 翻成 404（与视图不可达同一个 notFoundBody）。 */
export function isViewFieldNotFoundError(err: unknown): boolean {
  return err instanceof FieldNotFoundError;
}

const VIEW_TYPES = ['grid', 'kanban'] as const;
const FILTER_OPS = ['contains', 'equals', 'gt', 'lt'] as const;
const SORT_DIRS = ['asc', 'desc'] as const;

export interface ViewFilter {
  field_id: string;
  op: string;
  value: unknown;
}
export interface ViewSort {
  field_id: string;
  dir: string;
}

/** prefs JSONB 里存的视图体（存 field_id，绝不存字段显示名）。 */
interface ViewPrefs {
  name: string;
  view_type: string;
  filters: ViewFilter[];
  sorts: ViewSort[];
  group_field_id: string | null;
  hidden_field_ids: string[];
  is_active: boolean;
}

/** 对外的 View 对象（合同 Response Schema，顶层 keys 恰好十个）。 */
export interface View {
  view_id: string;
  name: string;
  view_type: string;
  filters: ViewFilter[];
  sorts: ViewSort[];
  group_field_id: string | null;
  hidden_field_ids: string[];
  is_active: boolean;
  degraded: boolean;
  updated_at: string;
}

/** 表可达性判定（与 rows service 同口径，四合一 null）。 */
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

/**
 * 视图可达性判定：视图归属 (org_id, table_id, member_id) 三键**逐维**立起来，且所在表可达。
 * 缺任一维即 null → 404。只守 org 维时，同组织他人就能读改你的视图（member 维是空的）。
 */
async function resolveViewRow(
  db: Queryable,
  viewId: string,
  orgId: string,
  memberId: string
): Promise<{ id: string; table_id: string; prefs: ViewPrefs; updated_at: string } | null> {
  if (!isUuid(viewId)) return null;
  const r = await db.query(
    `SELECT v.id, v.table_id, v.prefs, v.updated_at
       FROM zenithjoy.db_view_prefs v
       JOIN zenithjoy.db_tables t ON t.id = v.table_id AND t.org_id = v.org_id
      WHERE v.id = $1 AND v.org_id = $2 AND v.member_id = $3 AND t.deleted_at IS NULL
        AND (t.visibility = 'org' OR t.owner_member_id = $3)`,
    [viewId, orgId, memberId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    id: String(row.id),
    table_id: String(row.table_id),
    prefs: normalizePrefs(row.prefs),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

function normalizePrefs(raw: unknown): ViewPrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const filters = Array.isArray(p.filters) ? (p.filters as ViewFilter[]) : [];
  const sorts = Array.isArray(p.sorts) ? (p.sorts as ViewSort[]) : [];
  return {
    name: typeof p.name === 'string' ? p.name : '',
    view_type: p.view_type === 'kanban' ? 'kanban' : 'grid',
    filters: filters.map((f) => ({ field_id: String(f.field_id), op: String(f.op), value: f.value ?? null })),
    sorts: sorts.map((s) => ({ field_id: String(s.field_id), dir: String(s.dir) })),
    group_field_id:
      typeof p.group_field_id === 'string' && p.group_field_id ? p.group_field_id : null,
    hidden_field_ids: Array.isArray(p.hidden_field_ids)
      ? (p.hidden_field_ids as unknown[]).map((x) => String(x))
      : [],
    is_active: p.is_active === true,
  };
}

/**
 * 把库里那行投影成 View，读路径按当前存活字段集降级：
 * 失效的 group_field_id → null，失效的 sort/filter/hidden 引用被剔除，任一剔除即 degraded=true。
 * 只改读出来的东西，库里 prefs 一个字节不动。
 */
function projectView(
  id: string,
  prefs: ViewPrefs,
  updatedAt: string,
  liveFieldIds: Set<string>
): View {
  let degraded = false;

  let groupFieldId = prefs.group_field_id;
  if (groupFieldId !== null && !liveFieldIds.has(groupFieldId)) {
    groupFieldId = null;
    degraded = true;
  }

  const sorts = prefs.sorts.filter((s) => liveFieldIds.has(s.field_id));
  if (sorts.length !== prefs.sorts.length) degraded = true;

  const filters = prefs.filters.filter((f) => liveFieldIds.has(f.field_id));
  if (filters.length !== prefs.filters.length) degraded = true;

  const hidden = prefs.hidden_field_ids.filter((fid) => liveFieldIds.has(fid));
  if (hidden.length !== prefs.hidden_field_ids.length) degraded = true;

  return {
    view_id: id,
    name: prefs.name,
    view_type: prefs.view_type,
    filters: filters.map((f) => ({ field_id: f.field_id, op: f.op, value: f.value })),
    sorts: sorts.map((s) => ({ field_id: s.field_id, dir: s.dir })),
    group_field_id: groupFieldId,
    hidden_field_ids: hidden,
    is_active: prefs.is_active,
    degraded,
    updated_at: updatedAt,
  };
}

async function liveFieldSet(tableId: string, orgId: string): Promise<Map<string, FieldOut>> {
  const fields = await listFieldRows(tableId, orgId);
  return new Map(fields.map((f) => [f.field_id, f]));
}

/** 审计尽力而为：审计断链只打日志，不把一次已经落库的写变成 5xx（与 rows service 同口径）。 */
async function writeViewAudit(
  db: Queryable,
  orgId: string,
  tableId: string,
  memberId: string,
  action: string,
  viewId: string
): Promise<void> {
  await db
    .query(
      `INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      // INV-5 日志脱敏：只记 view_id，绝不记视图名正文
      [orgId, tableId, memberId, action, JSON.stringify({ view_id: viewId })]
    )
    .catch((err) => {
      console.error(`[workbench-views] ${action} 审计写入失败:`, (err as Error).message);
    });
}

// ── 入参校验（视图体形状）───────────────────────────────────────────────────

/**
 * group_field_id 判定：404 优先于 400。
 *  - null/undefined → 不分组
 *  - 非 UUID 形态 → 形状非法 400（它永远不可能是本表某个字段，不牵涉存在性泄露）
 *  - 合法 UUID 但不属本表 → 404（含他企业真实 field_id）
 *  - 属本表但类型 ≠ single_select → 400 GROUP_FIELD_TYPE_INVALID
 */
function resolveGroupField(
  raw: unknown,
  fieldMap: Map<string, FieldOut>
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !isUuid(raw)) {
    throw new WorkbenchValidationError('group_field_id 形态非法');
  }
  const field = fieldMap.get(raw);
  if (!field) throw new FieldNotFoundError();
  if (field.field_type !== 'single_select') throw new GroupFieldTypeError();
  return raw;
}

function normalizeFilters(raw: unknown): ViewFilter[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new WorkbenchValidationError('filters 必须是数组');
  return raw.map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    if (typeof f.field_id !== 'string' || !f.field_id) {
      throw new WorkbenchValidationError('filter.field_id 必填');
    }
    const op = typeof f.op === 'string' ? f.op : '';
    if (!(FILTER_OPS as readonly string[]).includes(op)) {
      throw new WorkbenchValidationError('filter.op 不在白名单内');
    }
    return { field_id: f.field_id, op, value: f.value ?? null };
  });
}

function normalizeSorts(raw: unknown): ViewSort[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new WorkbenchValidationError('sorts 必须是数组');
  return raw.map((item) => {
    const s = (item ?? {}) as Record<string, unknown>;
    if (typeof s.field_id !== 'string' || !s.field_id) {
      throw new WorkbenchValidationError('sort.field_id 必填');
    }
    const dir = typeof s.dir === 'string' ? s.dir : '';
    if (!(SORT_DIRS as readonly string[]).includes(dir)) {
      throw new WorkbenchValidationError('sort.dir 不在白名单内');
    }
    return { field_id: s.field_id, dir };
  });
}

function normalizeHidden(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new WorkbenchValidationError('hidden_field_ids 必须是数组');
  return raw.map((x) => String(x));
}

function normalizeViewType(raw: unknown, fallback: string): string {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !(VIEW_TYPES as readonly string[]).includes(raw)) {
    throw new WorkbenchValidationError('view_type 只能是 grid 或 kanban');
  }
  return raw;
}

/** is_active 置一清余（判定点 JC4）：本 member 在本表同时至多一个 active。 */
async function clearOtherActive(
  db: Queryable,
  tableId: string,
  orgId: string,
  memberId: string,
  keepViewId: string
): Promise<void> {
  await db.query(
    `UPDATE zenithjoy.db_view_prefs
        SET prefs = jsonb_set(prefs, '{is_active}', 'false'::jsonb), updated_at = NOW()
      WHERE table_id = $1 AND org_id = $2 AND member_id = $3 AND id <> $4`,
    [tableId, orgId, memberId, keepViewId]
  );
}

// ── 读 ──────────────────────────────────────────────────────────────────────

export async function listViews(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<{ views: View[]; active_view_id: string | null } | null> {
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;

  const fieldMap = await liveFieldSet(tableId, orgId);
  const liveIds = new Set(fieldMap.keys());

  const r = await pool.query(
    `SELECT v.id, v.prefs, v.updated_at
       FROM zenithjoy.db_view_prefs v
      WHERE v.table_id = $1 AND v.org_id = $2 AND v.member_id = $3
      ORDER BY v.created_at ASC, v.id ASC`,
    [tableId, orgId, memberId]
  );
  const views = r.rows.map((row: Record<string, unknown>) =>
    projectView(
      String(row.id),
      normalizePrefs(row.prefs),
      new Date(row.updated_at as string).toISOString(),
      liveIds
    )
  );
  const active = views.find((v) => v.is_active);
  return { views, active_view_id: active ? active.view_id : null };
}

// ── 写 ──────────────────────────────────────────────────────────────────────

export async function createView(
  orgId: string,
  memberId: string,
  tableId: string,
  body: Record<string, unknown>
): Promise<View | null> {
  const table = await resolveTable(pool, tableId, orgId, memberId);
  if (!table) return null;

  const fieldMap = await liveFieldSet(tableId, orgId);

  // 404 优先：group_field_id 不属本表先于任何 400 校验
  const groupFieldId = resolveGroupField(body.group_field_id, fieldMap);
  const prefs: ViewPrefs = {
    name: typeof body.name === 'string' ? body.name : '',
    view_type: normalizeViewType(body.view_type, 'grid'),
    filters: normalizeFilters(body.filters),
    sorts: normalizeSorts(body.sorts),
    group_field_id: groupFieldId,
    hidden_field_ids: normalizeHidden(body.hidden_field_ids),
    is_active: body.is_active === true,
  };

  const r = await pool.query(
    `INSERT INTO zenithjoy.db_view_prefs (table_id, org_id, member_id, prefs)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, updated_at`,
    [tableId, orgId, memberId, JSON.stringify(prefs)]
  );
  const viewId = String(r.rows[0].id);
  if (prefs.is_active) await clearOtherActive(pool, tableId, orgId, memberId, viewId);
  await writeViewAudit(pool, orgId, tableId, memberId, 'create_view', viewId);

  const liveIds = new Set(fieldMap.keys());
  return projectView(viewId, prefs, new Date(r.rows[0].updated_at as string).toISOString(), liveIds);
}

export async function patchView(
  orgId: string,
  memberId: string,
  viewId: string,
  body: Record<string, unknown>
): Promise<View | null> {
  const existing = await resolveViewRow(pool, viewId, orgId, memberId);
  if (!existing) return null;

  const fieldMap = await liveFieldSet(existing.table_id, orgId);
  const prefs = existing.prefs;

  // 增量补丁语义（与 PATCH /rows/:id 同族）：只覆盖给了的字段。404 优先于 400。
  if ('group_field_id' in body) {
    prefs.group_field_id = resolveGroupField(body.group_field_id, fieldMap);
  }
  if ('view_type' in body) prefs.view_type = normalizeViewType(body.view_type, prefs.view_type);
  if ('name' in body && typeof body.name === 'string') prefs.name = body.name;
  if ('filters' in body) prefs.filters = normalizeFilters(body.filters);
  if ('sorts' in body) prefs.sorts = normalizeSorts(body.sorts);
  if ('hidden_field_ids' in body) prefs.hidden_field_ids = normalizeHidden(body.hidden_field_ids);
  if ('is_active' in body) prefs.is_active = body.is_active === true;

  const r = await pool.query(
    `UPDATE zenithjoy.db_view_prefs
        SET prefs = $4::jsonb, updated_at = NOW()
      WHERE id = $1 AND org_id = $2 AND member_id = $3
      RETURNING id, updated_at`,
    [viewId, orgId, memberId, JSON.stringify(prefs)]
  );
  if (r.rowCount === 0) return null;
  if (prefs.is_active) await clearOtherActive(pool, existing.table_id, orgId, memberId, viewId);
  await writeViewAudit(pool, orgId, existing.table_id, memberId, 'update_view', viewId);

  const liveIds = new Set(fieldMap.keys());
  return projectView(viewId, prefs, new Date(r.rows[0].updated_at as string).toISOString(), liveIds);
}

export async function deleteView(
  orgId: string,
  memberId: string,
  viewId: string
): Promise<{ deleted_view_id: string; remaining: number } | null> {
  const existing = await resolveViewRow(pool, viewId, orgId, memberId);
  if (!existing) return null;

  // 至少保留一个视图：删前该 member 在该表的视图数为 1 时拒绝
  const c = await pool.query(
    `SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs
      WHERE table_id = $1 AND org_id = $2 AND member_id = $3`,
    [existing.table_id, orgId, memberId]
  );
  if (Number(c.rows[0].n) <= 1) throw new LastViewProtectedError();

  const r = await pool.query(
    `DELETE FROM zenithjoy.db_view_prefs
      WHERE id = $1 AND org_id = $2 AND member_id = $3
      RETURNING id`,
    [viewId, orgId, memberId]
  );
  if (r.rowCount === 0) return null;
  await writeViewAudit(pool, orgId, existing.table_id, memberId, 'delete_view', viewId);

  const remain = await pool.query(
    `SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs
      WHERE table_id = $1 AND org_id = $2 AND member_id = $3`,
    [existing.table_id, orgId, memberId]
  );
  return { deleted_view_id: viewId, remaining: Number(remain.rows[0].n) };
}

export interface AssignedItem {
  field_id: string;
  row_id: string;
  table_id: string;
  table_name: string;
}

/**
 * 「指派给我」全局视图：本组织当前会话可见的全部表里，任一 person 字段值 == 会话 memberId 的行。
 * 表级可见性延伸：同组织他人的 private 表零命中（WHERE 的 visibility 条件替它挡住）；他企业零命中（org_id）。
 */
export async function assignedToMe(orgId: string, memberId: string): Promise<{ items: AssignedItem[] }> {
  const r = await pool.query(
    `SELECT r.id AS row_id, f.id AS field_id, t.id AS table_id, t.name AS table_name
       FROM zenithjoy.db_tables t
       JOIN zenithjoy.db_fields f
         ON f.table_id = t.id AND f.org_id = t.org_id AND f.field_type = 'person'
       JOIN zenithjoy.db_rows r
         ON r.table_id = t.id AND r.org_id = t.org_id AND r.deleted_at IS NULL
        AND r.data ->> f.id::text = $2
      WHERE t.org_id = $1 AND t.deleted_at IS NULL
        AND (t.visibility = 'org' OR t.owner_member_id = $2)
      ORDER BY t.created_at ASC, r.row_order ASC`,
    [orgId, memberId]
  );
  return {
    items: r.rows.map((row: Record<string, unknown>) => ({
      field_id: String(row.field_id),
      row_id: String(row.row_id),
      table_id: String(row.table_id),
      table_name: String(row.table_name),
    })),
  };
}
