import { apiClient } from './client';

// ============ 类型定义 ============

export type FieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'number' | 'checkbox';

export interface FieldDefinition {
  id: string;
  field_name: string;
  field_type: FieldType;
  display_label: string;
  options?: string[];
  default_value?: string;
  is_required: boolean;
  display_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateFieldInput {
  field_name: string;
  field_type: FieldType;
  display_label: string;
  options?: string[];
  default_value?: string;
  is_required?: boolean;
}

export interface UpdateFieldInput {
  field_name?: string;
  field_type?: FieldType;
  display_label?: string;
  options?: string[];
  default_value?: string;
  is_required?: boolean;
  display_order?: number;
  is_visible?: boolean;
}

// ============ API 函数 ============

// 获取所有字段定义
export async function getFields(): Promise<FieldDefinition[]> {
  const response = await apiClient.get<FieldDefinition[]>('/fields');
  return response.data;
}

// 创建字段
export async function createField(field: CreateFieldInput): Promise<FieldDefinition> {
  const response = await apiClient.post<FieldDefinition>('/fields', field);
  return response.data;
}

// 更新字段
export async function updateField(id: string, updates: UpdateFieldInput): Promise<FieldDefinition> {
  const response = await apiClient.put<FieldDefinition>(`/fields/${id}`, updates);
  return response.data;
}

// 删除字段（软删除）
export async function deleteField(id: string): Promise<void> {
  await apiClient.delete(`/fields/${id}`);
}

// 批量更新排序
export async function reorderFields(ids: string[]): Promise<void> {
  await apiClient.put('/fields/reorder', { ids });
}

// 核心字段列表（不可删除）
export const CORE_FIELDS = [
  'title',
  'content_text',
  'content_type',
  'status',
  'account',
  'created_at',
  'updated_at',
  'first_published_at',
];

// 字段类型显示名称
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  textarea: '多行文本',
  select: '单选',
  multiselect: '多选',
  date: '日期',
  number: '数字',
  checkbox: '复选框',
};
