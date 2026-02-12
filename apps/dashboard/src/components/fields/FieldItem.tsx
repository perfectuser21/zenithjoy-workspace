import { GripVertical, Edit2, Trash2, Eye, EyeOff } from 'lucide-react';
import { FIELD_TYPE_LABELS, CORE_FIELDS, type FieldDefinition } from '../../api/fields.api';

interface FieldItemProps {
  field: FieldDefinition;
  onEdit: (field: FieldDefinition) => void;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string, visible: boolean) => void;
  isDragging?: boolean;
}

export function FieldItem({
  field,
  onEdit,
  onDelete,
  onToggleVisibility,
  isDragging,
}: FieldItemProps) {
  const isCoreField = CORE_FIELDS.includes(field.field_name);

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg p-4 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 拖拽手柄 */}
        <div className="text-gray-400 cursor-move mt-1">
          <GripVertical className="w-5 h-5" />
        </div>

        {/* 字段信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-gray-900">{field.display_label}</h3>
            {isCoreField && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                核心字段
              </span>
            )}
            {field.is_required && (
              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">
                必填
              </span>
            )}
          </div>

          <div className="text-sm text-gray-600">
            <span>类型: {FIELD_TYPE_LABELS[field.field_type]}</span>
            {field.options && field.options.length > 0 && (
              <span className="ml-4">
                选项: {field.options.join(', ')}
              </span>
            )}
          </div>

          {field.default_value && (
            <div className="text-xs text-gray-500 mt-1">
              默认值: {field.default_value}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          {/* 显示/隐藏 */}
          <button
            onClick={() => onToggleVisibility(field.id, !field.is_visible)}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title={field.is_visible ? '隐藏字段' : '显示字段'}
          >
            {field.is_visible ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>

          {/* 编辑 */}
          {!isCoreField && (
            <button
              onClick={() => onEdit(field)}
              className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
              title="编辑字段"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}

          {/* 删除 */}
          {!isCoreField && (
            <button
              onClick={() => {
                if (window.confirm(`确定要删除字段"${field.display_label}"吗？`)) {
                  onDelete(field.id);
                }
              }}
              className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
              title="删除字段"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
