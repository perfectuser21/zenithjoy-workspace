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
import type { CellValue, WorkbenchField, WorkbenchRow } from '../lib/workbenchFetch';
import { FieldIcon, personBadge, tagColor } from '../lib/workbenchFieldMeta';

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

function isEmpty(v: CellValue): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** 卡片上一枚属性（像 Notion 看板卡：多选/单选彩标、人员头像、数字/日期小字）。 */
function CardProp({ field, value }: { field: WorkbenchField; value: CellValue }) {
  if (isEmpty(value)) return null;
  if (field.field_type === 'single_select' || field.field_type === 'multi_select') {
    const arr = Array.isArray(value) ? value : [String(value)];
    return (
      <span className="kanban-card-tags">
        {arr.map((v) => {
          const c = tagColor(String(v));
          return (
            <span key={String(v)} className="wb-tag" style={{ background: c.bg, color: c.fg }}>
              <span className="wb-tag-dot" style={{ background: c.dot }} />
              {String(v)}
            </span>
          );
        })}
      </span>
    );
  }
  if (field.field_type === 'person') {
    const arr = Array.isArray(value) ? value : [String(value)];
    return (
      <span className="kanban-card-persons">
        {arr.map((v) => {
          const bd = personBadge(String(v));
          return (
            <span key={String(v)} className="wb-person">
              <span className="wb-avatar" style={{ background: bd.color.dot }}>{bd.initial}</span>
              {String(v)}
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <span className="kanban-card-meta">
      <FieldIcon type={field.field_type} className="wb-inline-ico" />
      {Array.isArray(value) ? value.join('、') : String(value)}
    </span>
  );
}

function KanbanCard({ row, fields, groupFieldId }: { row: WorkbenchRow; fields: WorkbenchField[]; groupFieldId: string | null }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.row_id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.6 : 1 }
    : undefined;
  // 卡片属性：跳过分组字段（列本身即它）与主标题文本字段，展示其余非空字段
  const titleFieldId = fields.find((f) => f.field_type === 'text')?.field_id;
  const props = fields.filter(
    (f) =>
      f.field_id &&
      f.field_id !== groupFieldId &&
      f.field_id !== titleFieldId &&
      !['relation', 'rollup', 'lookup', 'long_text'].includes(f.field_type) &&
      !isEmpty(row.data[f.field_id] ?? null)
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card${isDragging ? ' kanban-card-dragging' : ''}`}
      data-testid={`kanban-card-${row.row_id}`}
      {...listeners}
      {...attributes}
    >
      <div className="kanban-card-title">{cardLabel(row, fields)}</div>
      {props.length > 0 && (
        <div className="kanban-card-props">
          {props.map((f) => (
            <CardProp key={f.field_id} field={f} value={(row.data[f.field_id ?? ''] ?? null) as CellValue} />
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  columnValue,
  title,
  rows,
  fields,
  groupFieldId,
}: {
  columnValue: string;
  title: string;
  rows: WorkbenchRow[];
  fields: WorkbenchField[];
  groupFieldId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnValue });
  const ungrouped = columnValue === UNGROUPED;
  const c = tagColor(title);
  return (
    <div
      ref={setNodeRef}
      className={`kanban-column${isOver ? ' kanban-column-over' : ''}`}
      data-testid={`kanban-column-${columnValue}`}
    >
      <div className="kanban-column-head">
        <h3 className="kanban-column-title">
          <span className="kanban-col-dot" style={{ background: ungrouped ? 'var(--wb-line-strong)' : c.dot }} />
          {title}
        </h3>
        <span className="kanban-column-count">{rows.length}</span>
      </div>
      <div className="kanban-column-body">
        {rows.map((r) => (
          <KanbanCard key={r.row_id} row={r} fields={fields} groupFieldId={groupFieldId} />
        ))}
        {rows.length === 0 && <div className="kanban-column-empty">拖卡到这里</div>}
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
            groupFieldId={groupFieldId}
          />
        ))}
      </DndContext>
    </div>
  );
}
