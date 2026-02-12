import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFields,
  createField,
  updateField,
  deleteField,
  reorderFields,
  type CreateFieldInput,
  type UpdateFieldInput,
} from '../api/fields.api';

export function useFieldDefinitions() {
  const queryClient = useQueryClient();

  // 获取所有字段
  const query = useQuery({
    queryKey: ['fields'],
    queryFn: getFields,
  });

  // 创建字段
  const createMutation = useMutation({
    mutationFn: createField,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
    },
  });

  // 更新字段
  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: UpdateFieldInput }) =>
      updateField(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
    },
  });

  // 删除字段
  const deleteMutation = useMutation({
    mutationFn: deleteField,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
    },
  });

  // 批量更新排序
  const reorderMutation = useMutation({
    mutationFn: reorderFields,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] });
    },
  });

  return {
    fields: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    createField: createMutation.mutate,
    updateField: updateMutation.mutate,
    deleteField: deleteMutation.mutate,
    reorderFields: reorderMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isReordering: reorderMutation.isPending,
  };
}
