import { FIELD_TYPE_LABELS, type FieldType } from '../../api/fields.api';

interface FieldTypeSelectorProps {
  value: FieldType;
  onChange: (type: FieldType) => void;
  disabled?: boolean;
}

export function FieldTypeSelector({ value, onChange, disabled }: FieldTypeSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FieldType)}
      disabled={disabled}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
    >
      {Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => (
        <option key={type} value={type}>
          {label}
        </option>
      ))}
    </select>
  );
}
