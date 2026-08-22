/**
 * 看板视图组件 —— 按单选字段分列 + 指针拖卡改值（路③ Sprint C / S3）
 *
 * 用真 @dnd-kit：PointerSensor（真指针拖拽）+ KeyboardSensor（键盘可达，无障碍）。
 * 分列与拖卡落库映射都走 lib/workbenchKanban.ts 的纯函数（合同变异证明的注入点在那）。
 *
 * A26 结构预留（弱约束）：本组件**不依赖路由上下文**（不读路由参数、不做路由跳转），
 * 所需一切从 props 进来，因此能被路② 页面内嵌 database 直接挂载。
 */
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { groupRowsByField, resolveDropPatch, UNGROUPED, type DropPatch } from '../lib/workbenchKanban';
import type { WorkbenchField, WorkbenchRow } from '../lib/workbenchFetch';

interface Props {
  fields: WorkbenchField[];
  rows: WorkbenchRow[];
  groupFieldId: string | null;
  onCardMoved: (patch: DropPatch) => void;
}

/** 卡片正文：取第一个文本字段的值，没有就退到 row_id 前 8 位——只为让人看得见，拖拽靠 testid 定位。 */
function cardLabel(row: WorkbenchRow, fields: WorkbenchField[]): string {
  const textField = fields.find((f) => f.field_type === 'text');
  const v = textField?.field_id ? row.data[textField.field_id] : undefined;
  const text = typeof v === 'string' && v.length > 0 ? v : `行 ${row.row_id.slice(0, 8)}`;
  return text;
}

function KanbanCard({ row, label }: { row: WorkbenchRow; label: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.row_id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.6 : 1 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="kanban-card"
      data-testid={`kanban-card-${row.row_id}`}
      {...listeners}
      {...attributes}
    >
      {label}
    </div>
  );
}

function KanbanColumn({
  columnValue,
  title,
  rows,
  fields,
}: {
  columnValue: string;
  title: string;
  rows: WorkbenchRow[];
  fields: WorkbenchField[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnValue });
  return (
    <div
      ref={setNodeRef}
      className={`kanban-column${isOver ? ' kanban-column-over' : ''}`}
      data-testid={`kanban-column-${columnValue}`}
    >
      <h3 className="kanban-column-title">{title}</h3>
      <div className="kanban-column-body">
        {rows.map((r) => (
          <KanbanCard key={r.row_id} row={r} label={cardLabel(r, fields)} />
        ))}
      </div>
    </div>
  );
}

export default function WorkbenchKanbanView({ fields, rows, groupFieldId, onCardMoved }: Props) {
  // 一点点激活距离，避免"点一下"被误判成拖拽；真浏览器里 mouse.down → move(steps) → up 会越过它
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const groupField = fields.find((f) => f.field_id === groupFieldId);
  const options = groupField?.options ?? [];
  const columns = groupRowsByField(
    rows as never,
    groupFieldId ?? '',
    options
  );
  const rowById = new Map(rows.map((r) => [r.row_id, r]));

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || !groupFieldId) return;
    const patch = resolveDropPatch(rows as never, activeId, overId, groupFieldId);
    if (patch) onCardMoved(patch);
  };

  return (
    <div className="kanban-board" data-testid="kanban-board">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {columns.map((col) => (
          <KanbanColumn
            key={col.column_value}
            columnValue={col.column_value}
            title={col.column_value === UNGROUPED ? '未分组' : col.column_value}
            rows={col.row_ids.map((id) => rowById.get(id)).filter((r): r is WorkbenchRow => Boolean(r))}
            fields={fields}
          />
        ))}
      </DndContext>
    </div>
  );
}
