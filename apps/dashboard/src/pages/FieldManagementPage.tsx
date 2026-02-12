import { useState } from 'react';
import { ArrowLeft, Plus, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFieldDefinitions } from '../hooks/useFieldDefinitions';
import { FieldList } from '../components/fields/FieldList';
import { FieldEditor } from '../components/fields/FieldEditor';
import type { FieldDefinition } from '../api/fields.api';

export default function FieldManagementPage() {
  const navigate = useNavigate();
  const {
    fields,
    isLoading,
    createField,
    updateField,
    deleteField,
    reorderFields,
    isCreating,
    isUpdating,
  } = useFieldDefinitions();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDefinition | undefined>();

  const handleCreate = () => {
    setEditingField(undefined);
    setIsEditorOpen(true);
  };

  const handleEdit = (field: FieldDefinition) => {
    setEditingField(field);
    setIsEditorOpen(true);
  };

  const handleSave = (data: Parameters<typeof createField>[0]) => {
    if (editingField) {
      // 编辑模式
      updateField(
        { id: editingField.id, updates: data },
        {
          onSuccess: () => {
            setIsEditorOpen(false);
            setEditingField(undefined);
          },
        }
      );
    } else {
      // 新增模式
      createField(data, {
        onSuccess: () => {
          setIsEditorOpen(false);
        },
      });
    }
  };

  const handleToggleVisibility = (id: string, visible: boolean) => {
    updateField({ id, updates: { is_visible: visible } });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/works')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>返回</span>
            </button>
            <h1 className="text-xl font-semibold text-gray-900">字段管理</h1>
          </div>

          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            新增字段
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <FieldList
            fields={fields}
            onEdit={handleEdit}
            onDelete={deleteField}
            onToggleVisibility={handleToggleVisibility}
            onReorder={reorderFields}
          />
        </div>
      </div>

      {/* Editor Modal */}
      {isEditorOpen && (
        <FieldEditor
          field={editingField}
          onSave={handleSave}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingField(undefined);
          }}
          isLoading={isCreating || isUpdating}
        />
      )}
    </div>
  );
}
