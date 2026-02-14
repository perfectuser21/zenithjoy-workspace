import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { FieldTypeSelector } from './FieldTypeSelector';
import type { FieldDefinition, FieldType } from '../../api/fields.api';

interface FieldEditorProps {
  field?: FieldDefinition; // 编辑模式传入
  onSave: (data: {
    field_name: string;
    field_type: FieldType;
    display_label: string;
    options?: string[];
    default_value?: string;
    is_required?: boolean;
  }) => void;
  onClose: () => void;
  isLoading?: boolean;
}

export function FieldEditor({ field, onSave, onClose, isLoading }: FieldEditorProps) {
  const [fieldName, setFieldName] = useState(field?.field_name || '');
  const [displayLabel, setDisplayLabel] = useState(field?.display_label || '');
  const [fieldType, setFieldType] = useState<FieldType>(field?.field_type || 'text');
  const [options, setOptions] = useState<string[]>(field?.options || []);
  const [defaultValue, setDefaultValue] = useState(field?.default_value || '');
  const [isRequired, setIsRequired] = useState(field?.is_required || false);

  // 根据字段类型初始化选项
  useEffect(() => {
    if (!field && (fieldType === 'select' || fieldType === 'multiselect')) {
      if (options.length === 0) {
        setOptions(['选项 1']);
      }
    }
  }, [fieldType, field, options.length]);

  const handleAddOption = () => {
    setOptions([...options, `选项 ${options.length + 1}`]);
  };

  const handleRemoveOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      field_name: fieldName,
      field_type: fieldType,
      display_label: displayLabel,
      options: (fieldType === 'select' || fieldType === 'multiselect') ? options : undefined,
      default_value: defaultValue || undefined,
      is_required: isRequired,
    };

    onSave(data);
  };

  const isEdit = !!field;
  const needsOptions = fieldType === 'select' || fieldType === 'multiselect';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? '编辑字段' : '新增字段'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 字段名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              字段名 (英文标识符)
            </label>
            <input
              type="text"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="例如: mood"
              required
              disabled={isEdit} // 编辑时不允许修改字段名
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            />
            {isEdit && (
              <p className="text-xs text-gray-500 mt-1">字段名不可修改</p>
            )}
          </div>

          {/* 显示名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              显示名称
            </label>
            <input
              type="text"
              value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)}
              placeholder="例如: 心情"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 字段类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              字段类型
            </label>
            <FieldTypeSelector
              value={fieldType}
              onChange={setFieldType}
              disabled={isEdit} // 编辑时不允许修改类型
            />
            {isEdit && (
              <p className="text-xs text-gray-500 mt-1">字段类型不可修改</p>
            )}
          </div>

          {/* 选项（仅单选/多选） */}
          {needsOptions && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选项列表
              </label>
              <div className="space-y-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`选项 ${index + 1}`}
                      required
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {options.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddOption}
                className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                <Plus className="w-4 h-4" />
                添加选项
              </button>
            </div>
          )}

          {/* 默认值 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              默认值（可选）
            </label>
            {fieldType === 'checkbox' ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={defaultValue === 'true'}
                  onChange={(e) => setDefaultValue(e.target.checked ? 'true' : 'false')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">默认选中</span>
              </label>
            ) : (
              <input
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="留空表示无默认值"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            )}
          </div>

          {/* 必填 */}
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">必填字段</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
