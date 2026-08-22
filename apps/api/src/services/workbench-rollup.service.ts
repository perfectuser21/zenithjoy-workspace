/**
 * 路③ 结构化工作台 · rollup 读服务 —— S4「关联连得上」之上的 rollup/lookup 聚合加厚（Sprint E）
 *
 * ⚠️ 钉死路径（合同 A41 墙裁定）：rollup 聚合读逻辑**必须**落在本文件
 * `apps/api/src/services/workbench-rollup.service.ts`，**不得**并入 workbench-relations/其他服务文件
 * ——给 A41 守卫一个固定 grep 靶，避免『或等价路径』导致 must-not-import 检查恒空假绿。
 * 本文件**不被** `apps/api/src/knowledge/` 下的检索特征文件 import：rollup 富数据不进路①问答检索域。
 *
 * 三条纪律承接前四刀，一条不改：
 *  1. **组织归属只来自入参 orgId**（由 workbenchAuthGuard 从会话解析）；聚合基数的 org 判定同源，
 *     每条 SQL 自带 `org_id = $orgId` 是纵深防御（A38：库里被越权改脏的行不进聚合基数）。
 *  2. **读时计算不落库、零新建表**（J13/J14）：聚合值不物化，配置读自 db_fields.options 位序三元组
 *     `[relation_field_id, target_field_id, fn]`（lookup 无 fn 位，fn 隐含 'lookup'）。
 *  3. **失效降级不悬空**（A39）：relation 字段/目标字段被软删、目标表被软删 → getTable/活字段解析
 *     返 null → 该 rollup 单元格 value 置 null + degraded=true，绝不裸访问已删字段、绝不 5xx。
 */
import type { Pool, PoolClient } from 'pg';
import pool from '../db/connection';
import {
  getTable,
  isUuid,
  ROLLUP_FIELD_TYPE,
  LOOKUP_FIELD_TYPE,
  RELATION_FIELD_TYPE,
  type FieldOut,
  type TableDetail,
} from './workbench.service';

/** 一个 rollup/lookup 单元格：读时计算的聚合值（只读，不物化）。 */
export interface RollupCell {
  row_id: string;
  field_id: string;
  fn: string;
  value: number | string | null;
  degraded: boolean;
}

export interface RollupsOut {
  table_id: string;
  cells: RollupCell[];
}

/** 一个 rollup/lookup 字段解析结果：或降级（依赖失效），或就绪（带目标表/字段/聚合函数）。 */
interface FieldPlan {
  fieldId: string;
  fn: string;
  degraded: boolean; // 依赖失效（relation 字段/目标字段/目标表软删）→ 全行降级
  relationFieldId?: string;
  targetTableId?: string;
  targetFieldId?: string; // count 无目标字段
  targetFieldType?: string;
}

/**
 * 把 rollup/lookup 字段解析成执行计划：任一依赖失效 → degraded=true（A39 三支）。
 *   ① relation 字段被删/非本表 relation → degraded（A39①）
 *   ② 目标表软删 → getTable 返 null → degraded（A39③）
 *   ③ 目标字段被删（count 除外，count 不需目标字段）→ degraded（A39②）
 */
async function planField(
  orgId: string,
  memberId: string,
  srcTable: TableDetail,
  field: FieldOut
): Promise<FieldPlan> {
  const isLookup = field.field_type === LOOKUP_FIELD_TYPE;
  const fn = isLookup ? 'lookup' : String(field.options[2] ?? '');
  const plan: FieldPlan = { fieldId: field.field_id, fn, degraded: false };

  // ① relation 字段必须是本表当前存活的 relation 字段（软删后不在 srcTable.fields 活清单里）
  const relFieldId = field.options[0];
  const relField = srcTable.fields.find(
    (x) => x.field_id === relFieldId && x.field_type === RELATION_FIELD_TYPE
  );
  if (!relField) {
    plan.degraded = true;
    return plan;
  }
  plan.relationFieldId = relFieldId;

  // ② 目标表可见（软删 → getTable 返 null → 降级）
  const targetTableId = relField.options[0];
  if (typeof targetTableId !== 'string' || !isUuid(targetTableId)) {
    plan.degraded = true;
    return plan;
  }
  const targetTable = await getTable(orgId, memberId, targetTableId);
  if (!targetTable) {
    plan.degraded = true;
    return plan;
  }
  plan.targetTableId = targetTableId;

  // ③ 目标字段（count 不需要）——被软删则不在活字段清单里 → 降级
  if (fn === 'count') {
    return plan;
  }
  const targetFieldId = field.options[1];
  const targetField = targetTable.fields.find((x) => x.field_id === targetFieldId);
  if (!targetField) {
    plan.degraded = true;
    return plan;
  }
  plan.targetFieldId = targetFieldId;
  plan.targetFieldType = targetField.field_type;
  return plan;
}

/** 顺 relation 目标 row_ids 去目标表捞「本 org 存活」行（A38：`org_id = $orgId` 剔越权脏行）。 */
async function fetchTargetRows(
  db: Pool | PoolClient,
  targetTableId: string,
  orgId: string,
  rowIds: string[]
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const ids = rowIds.filter((x) => typeof x === 'string' && isUuid(x));
  if (ids.length === 0) return [];
  // A38 聚合隔离：`AND r.org_id = $2` 把被越权改成他企业的目标行剔出聚合基数。
  // 按 row_order 升序返回（J15：concat/lookup 多值按 row_order 升序 `, ` 拼接不截断）。
  const r = await db.query(
    `SELECT r.id, r.data
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL AND r.id = ANY($3::uuid[])
      ORDER BY r.row_order ASC, r.created_at ASC`,
    [targetTableId, orgId, ids]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    data: (row.data ?? {}) as Record<string, unknown>,
  }));
}

/** 目标字段值→展示字符串（J15 多值格式化：date=YYYY-MM-DD、其余 String()）。null/空跳过。 */
function formatDisplay(raw: unknown, fieldType?: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (fieldType === 'date') return String(raw).slice(0, 10);
  return String(raw);
}

/**
 * 一个 (源行 × rollup 字段) 的聚合值。依赖失效 → null+degraded；数值规整跳过非数值行 → degraded。
 */
function aggregate(
  plan: FieldPlan,
  targetRows: Array<{ id: string; data: Record<string, unknown> }>
): { value: number | string | null; degraded: boolean } {
  switch (plan.fn) {
    case 'count':
      return { value: targetRows.length, degraded: false };
    case 'sum':
    case 'min':
    case 'max': {
      const nums: number[] = [];
      let skipped = false;
      for (const row of targetRows) {
        const raw = row.data[plan.targetFieldId!];
        // 空/缺值：视为该行无此金额，跳过但不算脏（不 degrade）
        if (raw === undefined || raw === null || raw === '') continue;
        // JSONB 数字可能以 string 存（粘贴导入一律文本）→ Number() 规整，绝不字符串拼接冒充 sum
        const n = Number(raw);
        if (Number.isFinite(n)) {
          nums.push(n);
        } else {
          skipped = true; // 非数值目标行跳过 + degraded（如 "abc"）
        }
      }
      if (plan.fn === 'sum') {
        return { value: nums.reduce((a, b) => a + b, 0), degraded: skipped };
      }
      if (nums.length === 0) return { value: null, degraded: skipped };
      const v = plan.fn === 'min' ? Math.min(...nums) : Math.max(...nums);
      return { value: v, degraded: skipped };
    }
    case 'concat':
    case 'lookup': {
      const parts: string[] = [];
      for (const row of targetRows) {
        const disp = formatDisplay(row.data[plan.targetFieldId!], plan.targetFieldType);
        if (disp !== null) parts.push(disp);
      }
      return { value: parts.join(', '), degraded: false };
    }
    default:
      // 未知 fn（不该发生：建字段时已 A40 白名单校验）→ 安全降级，不抛
      return { value: null, degraded: true };
  }
}

/**
 * 读某张表**每条存活源行 × 每个 rollup/lookup 字段**的聚合值（GET /tables/:id/rollups）。
 *
 * 源表跨企业/私有非表主/随机不存在/已软删 → getTable 返 null → 本函数返 null（路由翻统一 404）。
 * 读时计算不落库：聚合值不写任何行/列，子记录一改下次读即最新。
 */
export async function computeRollups(
  orgId: string,
  memberId: string,
  tableId: string
): Promise<RollupsOut | null> {
  if (!isUuid(tableId)) return null;
  const srcTable = await getTable(orgId, memberId, tableId);
  if (!srcTable) return null;

  const rollupFields = srcTable.fields.filter(
    (f) => f.field_type === ROLLUP_FIELD_TYPE || f.field_type === LOOKUP_FIELD_TYPE
  );
  if (rollupFields.length === 0) {
    return { table_id: tableId, cells: [] };
  }

  // 源表所有存活行（读时聚合的行维基数）
  const srcRowsRes = await pool.query(
    `SELECT r.id, r.data
       FROM zenithjoy.db_rows r
      WHERE r.table_id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL
      ORDER BY r.row_order ASC, r.created_at ASC`,
    [tableId, orgId]
  );
  const srcRows = srcRowsRes.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    data: (row.data ?? {}) as Record<string, unknown>,
  }));

  // 每个 rollup 字段解析一次执行计划（依赖失效 → degraded）
  const plans: FieldPlan[] = [];
  for (const f of rollupFields) {
    plans.push(await planField(orgId, memberId, srcTable, f));
  }

  const cells: RollupCell[] = [];
  for (const plan of plans) {
    if (plan.degraded) {
      // A39：依赖失效 → 该字段所有源行单元格 value=null + degraded=true（可见降级占位，不悬空）
      for (const sr of srcRows) {
        cells.push({ row_id: sr.id, field_id: plan.fieldId, fn: plan.fn, value: null, degraded: true });
      }
      continue;
    }
    // 就绪字段：逐源行顺 relation 目标 row_ids 去目标表捞值聚合（读时计算）
    for (const sr of srcRows) {
      const rel = sr.data[plan.relationFieldId!];
      const targetIds = Array.isArray(rel) ? (rel as unknown[]).map((x) => String(x)) : [];
      const targetRows = await fetchTargetRows(pool, plan.targetTableId!, orgId, targetIds);
      const { value, degraded } = aggregate(plan, targetRows);
      cells.push({ row_id: sr.id, field_id: plan.fieldId, fn: plan.fn, value, degraded });
    }
  }

  return { table_id: tableId, cells };
}
