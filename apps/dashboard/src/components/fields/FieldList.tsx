import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { FieldItem } from './FieldItem';
import { CORE_FIELDS, type FieldDefinition } from '../../api/fields.api';

interface FieldListProps {
  fields: FieldDefinition[];
  onEdit: (field: FieldDefinition) => void;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string, visible: boolean) => void;
  onReorder: (ids: string[]) => void;
}

export function FieldList({
  fields,
  onEdit,
  onDelete,
  onToggleVisibility,
  onReorder,
}: FieldListProps) {
  // 分离核心字段和自定义字段
  const coreFields = fields.filter((f) => CORE_FIELDS.includes(f.field_name));
  const customFields = fields.filter((f) => !CORE_FIELDS.includes(f.field_name));

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;

    if (sourceIndex === destIndex) return;

    // 判断拖拽的是哪个组
    const isCore = result.source.droppableId === 'core-fields';
    const sourceList = isCore ? coreFields : customFields;

    // 重新排序
    const items = Array.from(sourceList);
    const [reorderedItem] = items.splice(sourceIndex, 1);
    items.splice(destIndex, 0, reorderedItem);

    // 合并核心字段和自定义字段的新顺序
    const newOrder = isCore
      ? [...items, ...customFields]
      : [...coreFields, ...items];

    const ids = newOrder.map((item) => item.id);
    onReorder(ids);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="space-y-8">
        {/* 核心字段 */}
        {coreFields.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              核心字段（不可删除）
            </h3>
            <Droppable droppableId="core-fields">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {coreFields.map((field, index) => (
                    <Draggable key={field.id} draggableId={field.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <FieldItem
                            field={field}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onToggleVisibility={onToggleVisibility}
                            isDragging={snapshot.isDragging}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        )}

        {/* 自定义字段 */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            自定义字段
          </h3>
          <Droppable droppableId="custom-fields">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-2"
              >
                {customFields.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    暂无自定义字段，点击右上角"新增字段"按钮添加
                  </div>
                ) : (
                  customFields.map((field, index) => (
                    <Draggable key={field.id} draggableId={field.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <FieldItem
                            field={field}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onToggleVisibility={onToggleVisibility}
                            isDragging={snapshot.isDragging}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))
                )}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </DragDropContext>
  );
}
