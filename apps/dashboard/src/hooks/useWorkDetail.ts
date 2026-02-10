import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getWork, updateWork, type UpdateWorkInput } from '../api/works.api';

export function useWorkDetail(workId: string) {
  const queryClient = useQueryClient();

  // 获取作品详情
  const query = useQuery({
    queryKey: ['work', workId],
    queryFn: () => getWork(workId),
    enabled: !!workId,
  });

  // 更新作品
  const updateMutation = useMutation({
    mutationFn: (updates: UpdateWorkInput) => updateWork(workId, updates),
    onSuccess: (updatedWork) => {
      // 更新缓存
      queryClient.setQueryData(['work', workId], updatedWork);
      // 使列表查询失效，确保列表数据更新
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });

  return {
    work: query.data,
    isLoading: query.isLoading,
    error: query.error,
    updateWork: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error,
  };
}
