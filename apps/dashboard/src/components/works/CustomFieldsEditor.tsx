interface CustomField {
  name: string;
  type: 'text' | 'number' | 'date' | 'select';
  value: string | number;
  options?: string[]; // for select type
}

interface CustomFieldsEditorProps {
  fields: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
}

// 预定义的自定义字段
const PREDEFINED_FIELDS: CustomField[] = [
  { name: 'tags', type: 'text', value: '' },
  { name: 'priority', type: 'select', value: '中', options: ['低', '中', '高'] },
  { name: 'internal_notes', type: 'text', value: '' },
  { name: 'target_audience', type: 'text', value: '' },
];

export function CustomFieldsEditor({ fields, onChange }: CustomFieldsEditorProps) {
  const handleFieldChange = (fieldName: string, value: string | number) => {
    onChange({
      ...fields,
      [fieldName]: value,
    });
  };

  const getFieldValue = (fieldName: string, defaultValue: string | number = ''): string => {
    const value = fields[fieldName];
    if (value === undefined || value === null) return String(defaultValue);
    return String(value);
  };

  const renderField = (field: CustomField) => {
    const value = getFieldValue(field.name, field.value);

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      case 'date':
        return (
          <input
            type="date"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      case 'select':
        return (
          <select
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      default:
        return null;
    }
  };

  const getFieldLabel = (fieldName: string): string => {
    const labels: Record<string, string> = {
      tags: '标签',
      priority: '优先级',
      internal_notes: '内部笔记',
      target_audience: '目标受众',
    };
    return labels[fieldName] || fieldName;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4">自定义字段</h3>

      <div className="space-y-4">
        {PREDEFINED_FIELDS.map((field) => (
          <div key={field.name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {getFieldLabel(field.name)}
            </label>
            {renderField(field)}
          </div>
        ))}
      </div>
    </div>
  );
}
