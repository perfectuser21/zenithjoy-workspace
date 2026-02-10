import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { getWorks, createWork, deleteWork, type Work, type WorkFilters, type ContentType, type WorkStatus, type Account } from '../api/works.api';

// ============ 类型定义 ============

interface WorksListPageProps {}

// ============ 常量 ============

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图文' },
  { value: 'video', label: '视频' },
  { value: 'article', label: '长文' },
  { value: 'audio', label: '音频' },
];

const STATUSES: { value: WorkStatus; label: string; color: string }[] = [
  { value: 'draft', label: '草稿', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  { value: 'pending', label: '待发布', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  { value: 'published', label: '已发布', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  { value: 'archived', label: '已归档', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
];

const ACCOUNTS: { value: Account; label: string }[] = [
  { value: 'XXIP', label: 'XXIP' },
  { value: 'XXAI', label: 'XXAI' },
];

const PAGE_SIZES = [10, 20, 50, 100];

// ============ 主组件 ============

export default function WorksListPage({}: WorksListPageProps) {
  const queryClient = useQueryClient();

  // ========== 筛选状态 ==========
  const [filters, setFilters] = useState<WorkFilters>({
    limit: 20,
    offset: 0,
    sort: 'created_at',
    order: 'desc',
  });

  const [searchInput, setSearchInput] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // ========== 数据查询 ==========
  const { data, isLoading, error } = useQuery({
    queryKey: ['works', filters],
    queryFn: () => getWorks(filters),
    keepPreviousData: true,
  });

  // ========== 分页计算 ==========
  const currentPage = Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1;
  const totalPages = Math.ceil((data?.total || 0) / (filters.limit || 20));
  const startRecord = (filters.offset || 0) + 1;
  const endRecord = Math.min((filters.offset || 0) + (filters.limit || 20), data?.total || 0);

  // ========== 筛选处理 ==========
  const handleFilterChange = (key: keyof WorkFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      offset: 0, // 筛选时重置到第一页
    }));
  };

  const handleSearch = () => {
    setFilters(prev => ({
      ...prev,
      search: searchInput || undefined,
      offset: 0,
    }));
  };

  const handleClearFilters = () => {
    setFilters({
      limit: 20,
      offset: 0,
      sort: 'created_at',
      order: 'desc',
    });
    setSearchInput('');
  };

  // ========== 排序处理 ==========
  const handleSort = (field: 'created_at' | 'updated_at' | 'first_published_at' | 'title') => {
    setFilters(prev => ({
      ...prev,
      sort: field,
      order: prev.sort === field && prev.order === 'desc' ? 'asc' : 'desc',
    }));
  };

  // ========== 分页处理 ==========
  const handlePageChange = (page: number) => {
    setFilters(prev => ({
      ...prev,
      offset: (page - 1) * (prev.limit || 20),
    }));
  };

  const handlePageSizeChange = (size: number) => {
    setFilters(prev => ({
      ...prev,
      limit: size,
      offset: 0, // 改变页大小时重置到第一页
    }));
  };

  // ========== 渲染 ==========
  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-900 dark:to-slate-800">
      {/* 页头 */}
      <div className="flex items-center justify-between px-6 py-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">作品管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            管理所有内容作品
          </p>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建作品
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="px-6 py-4 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap gap-4 items-center">
          {/* 搜索框 */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索标题或内容..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* 类型筛选 */}
          <select
            value={filters.type || ''}
            onChange={(e) => handleFilterChange('type', e.target.value || undefined)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部类型</option>
            {CONTENT_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>

          {/* 状态筛选 */}
          <select
            value={filters.status || ''}
            onChange={(e) => handleFilterChange('status', e.target.value || undefined)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部状态</option>
            {STATUSES.map(status => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>

          {/* 账号筛选 */}
          <select
            value={filters.account || ''}
            onChange={(e) => handleFilterChange('account', e.target.value || undefined)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部账号</option>
            {ACCOUNTS.map(account => (
              <option key={account.value} value={account.value}>{account.label}</option>
            ))}
          </select>

          {/* 清除筛选 */}
          {(filters.type || filters.status || filters.account || filters.search) && (
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-red-500 dark:text-red-400 mb-2">加载失败</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{String(error)}</p>
            </div>
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-2">暂无作品</p>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                创建第一个作品
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th
                    onClick={() => handleSort('title')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                  >
                    标题 {filters.sort === 'title' && (filters.order === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    状态
                  </th>
                  <th
                    onClick={() => handleSort('created_at')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                  >
                    创建日期 {filters.sort === 'created_at' && (filters.order === 'desc' ? '↓' : '↑')}
                  </th>
                  <th
                    onClick={() => handleSort('first_published_at')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                  >
                    发布日期 {filters.sort === 'first_published_at' && (filters.order === 'desc' ? '↓' : '↑')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.data.map((work) => (
                  <tr
                    key={work.id}
                    className="hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                    onClick={() => {
                      // TODO: 跳转到详情页 (Phase 3)
                      console.log('打开作品详情:', work.id);
                    }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {work.title}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {CONTENT_TYPES.find(t => t.value === work.content_type)?.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        STATUSES.find(s => s.value === work.status)?.color
                      }`}>
                        {STATUSES.find(s => s.value === work.status)?.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {new Date(work.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {work.first_published_at
                        ? new Date(work.first_published_at).toLocaleDateString('zh-CN')
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页 */}
      {data && data.total > 0 && (
        <div className="px-6 py-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            {/* 记录统计 */}
            <div className="text-sm text-gray-600 dark:text-gray-400">
              显示 {startRecord}-{endRecord} / 共 {data.total} 条
            </div>

            {/* 分页控制 */}
            <div className="flex items-center gap-4">
              {/* 每页数量 */}
              <select
                value={filters.limit}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-sm"
              >
                {PAGE_SIZES.map(size => (
                  <option key={size} value={size}>每页 {size} 条</option>
                ))}
              </select>

              {/* 翻页按钮 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新建作品对话框 */}
      {showCreateDialog && (
        <CreateWorkDialog
          onClose={() => setShowCreateDialog(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['works'] });
            setShowCreateDialog(false);
          }}
        />
      )}
    </div>
  );
}

// ============ 新建作品对话框 ============

interface CreateWorkDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

function CreateWorkDialog({ onClose, onSuccess }: CreateWorkDialogProps) {
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: createWork,
    onSuccess: () => {
      onSuccess();
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || err.message || '创建失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('请输入标题');
      return;
    }

    createMutation.mutate({
      title: title.trim(),
      content_type: contentType,
      status: 'draft',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900/60 via-slate-800/50 to-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 对话框 */}
      <div className="relative bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 border border-white/20 dark:border-slate-700/50">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">新建作品</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入作品标题"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* 类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              内容类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentType)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            >
              {CONTENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={createMutation.isLoading}
              className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isLoading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
