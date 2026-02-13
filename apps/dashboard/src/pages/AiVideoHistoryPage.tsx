import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiVideoApi, type AiVideoGeneration } from '../api/ai-video.api';
import { Trash2, Download } from 'lucide-react';

export default function AiVideoHistoryPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: historyData, isLoading } = useQuery({
    queryKey: ['ai-video-history', statusFilter],
    queryFn: () => aiVideoApi.getHistory({ status: statusFilter, limit: 50 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => aiVideoApi.deleteGeneration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-video-history'] });
    },
  });

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这条记录吗？')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleDownload = (videoUrl: string, prompt: string) => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `${prompt.substring(0, 30)}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      queued: 'bg-gray-100 text-gray-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    const labels = {
      queued: '排队中',
      in_progress: '生成中',
      completed: '已完成',
      failed: '失败',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">AI 视频生成历史</h1>

        {/* Filters */}
        <div className="flex gap-2">
          {['all', 'completed', 'failed', 'in_progress', 'queued'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded ${
                statusFilter === status
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {status === 'all' ? '全部' : status === 'completed' ? '成功' : status === 'failed' ? '失败' : status === 'in_progress' ? '进行中' : '排队'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8">加载中...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  提示词
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  进度
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  创建时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  预览
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {historyData?.data.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="max-w-xs truncate" title={item.prompt}>
                      {item.prompt}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(item.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.progress}%
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(item.created_at).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {item.video_url && item.status === 'completed' && (
                      <video
                        src={item.video_url}
                        controls
                        className="h-16 rounded"
                        style={{ width: '120px' }}
                      />
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-2">
                      {item.video_url && item.status === 'completed' && (
                        <button
                          onClick={() => handleDownload(item.video_url!, item.prompt)}
                          className="text-blue-600 hover:text-blue-900"
                          title="下载视频"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-red-600 hover:text-red-900"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {historyData?.data.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              暂无记录
            </div>
          )}
        </div>
      )}

      {/* Pagination info */}
      {historyData && (
        <div className="mt-4 text-sm text-gray-500 text-center">
          共 {historyData.total} 条记录
        </div>
      )}
    </div>
  );
}
