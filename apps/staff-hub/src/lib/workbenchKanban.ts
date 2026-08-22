/**
 * 看板视图的纯逻辑 —— 分列（groupRowsByField）与拖卡落库映射（resolveDropPatch）
 *
 * 抽成纯函数不是为了复用那几行，是给合同的机械变异一个确定的注入点：
 *   - A20-ungrouped-null-only：把「未分组三态」判据改成只判 null → groupRowsByField 三态用例转红
 *   - A24-drag-wrong-row：把 resolveDropPatch 改成恒返 rows[0] → resolveDropPatch 单测转红
 *
 * 本文件**零外部依赖**（不 import @dnd-kit / React）：合同的 views-group-type.test.ts 在
 * apps/api 的 vitest 环境里动态 import 它，带上组件依赖会把那个纯逻辑用例拖进整棵 UI 依赖树。
 */

/** 未分组列的稳定列名（真浏览器里也用它当 testid：kanban-column-__ungrouped__）。 */
export const UNGROUPED = '__ungrouped__';

export interface KanbanRow {
  row_id: string;
  data: Record<string, unknown>;
  version: number;
  row_order: number;
  created_at: string;
  updated_at: string;
}

export interface KanbanColumn {
  column_value: string;
  row_ids: string[];
}

/**
 * 「用户眼里的没值」在 JSONB 里有三种物理形态，缺一态那态的卡片既不在选项列也不在未分组列，
 * 卡片凭空消失、用户以为数据丢了（判定点 JC3）。三态：值为 null / 键缺失 / 空串。
 */
function isUngrouped(row: KanbanRow, groupFieldId: string): boolean {
  if (!(groupFieldId in row.data)) return true; // 缺键
  const v = row.data[groupFieldId];
  if (v === null) return true; // 值为 null
  if (typeof v === 'string' && v.length === 0) return true; // 空串
  return false;
}

/**
 * 按单选字段把行分列：选项列按 options 原序，值不在 options 里的按出现顺序追加在选项列之后、
 * 未分组列之前，最后一列恒为 UNGROUPED。一行只落一列（单选分组下不会既在选项列又在未分组列）。
 */
export function groupRowsByField(
  rows: KanbanRow[],
  groupFieldId: string,
  options: string[]
): KanbanColumn[] {
  const buckets = new Map<string, string[]>();
  for (const opt of options) buckets.set(opt, []);
  const ungrouped: string[] = [];
  const extraOrder: string[] = [];

  for (const row of rows) {
    if (isUngrouped(row, groupFieldId)) {
      ungrouped.push(row.row_id);
      continue;
    }
    const value = String(row.data[groupFieldId]);
    if (!buckets.has(value)) {
      buckets.set(value, []);
      extraOrder.push(value);
    }
    buckets.get(value)!.push(row.row_id);
  }

  const columns: KanbanColumn[] = [];
  for (const opt of options) columns.push({ column_value: opt, row_ids: buckets.get(opt) ?? [] });
  for (const extra of extraOrder) columns.push({ column_value: extra, row_ids: buckets.get(extra)! });
  columns.push({ column_value: UNGROUPED, row_ids: ungrouped });
  return columns;
}

export interface DropPatch {
  row_id: string;
  version: number;
  data: Record<string, unknown>;
}

/**
 * 拖卡落库映射：写回的行是**被拖那一行**（activeCardId），不是列里第一行。
 * 拖到 UNGROUPED 列 → 清空该分组格（null）；拖到某选项列 → 该格改成目标列的值。
 * 返回 row_id + 其当前 version（走 PATCH /rows/:id 的乐观锁），拿不到那张卡即返 null。
 */
export function resolveDropPatch(
  rows: KanbanRow[],
  activeCardId: string,
  targetColumnValue: string,
  groupFieldId: string
): DropPatch | null {
  const row = rows.find((r) => r.row_id === activeCardId);
  if (!row) return null;
  const nextValue = targetColumnValue === UNGROUPED ? null : targetColumnValue;
  return { row_id: row.row_id, version: row.version, data: { [groupFieldId]: nextValue } };
}
