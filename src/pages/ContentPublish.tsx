import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Save,
  Calendar,
  Image as ImageIcon,
  Film,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Plus,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Eye,
  Copy,
  Check,
  User,
  Search,
  Filter,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Edit,
} from 'lucide-react';
import MediaUploader from '../components/MediaUploader';
import type { PlatformSpec, PublishTask, UploadedFile } from '../api/publish.api';
import { publishApi } from '../api/publish.api';

type MediaType = 'image' | 'video' | 'text';
type ViewMode = 'list' | 'create' | 'detail';
type FilterStatus = 'all' | 'draft' | 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
type FilterPlatform = 'all' | 'xhs' | 'weibo' | 'douyin' | 'website';

// Platform icon component
function PlatformIcon({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    xhs: 'bg-red-500',
    weibo: 'bg-orange-500',
    x: 'bg-black',
    douyin: 'bg-gray-800',
    website: 'bg-blue-600',
  };

  return (
    <div className={`w-8 h-8 rounded-lg ${colors[platform] || 'bg-gray-500'} flex items-center justify-center text-white text-xs font-bold`}>
      {platform.charAt(0).toUpperCase()}
    </div>
  );
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    draft: { bg: 'bg-gray-100 dark:bg-slate-700', text: 'text-gray-600 dark:text-gray-400', icon: <FileText className="w-3 h-3" /> },
    pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', icon: <Clock className="w-3 h-3" /> },
    processing: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', icon: <XCircle className="w-3 h-3" /> },
    partial: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', icon: <Clock className="w-3 h-3" /> },
  };

  const style = styles[status] || styles.draft;
  const labels: Record<string, string> = {
    draft: '草稿',
    pending: '待发布',
    processing: '发布中',
    completed: '已完成',
    failed: '失败',
    partial: '部分成功',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${style.bg} ${style.text}`}>
      {style.icon}
      {labels[status] || status}
    </span>
  );
}

// Platform display names
const platformDisplayNames: Record<string, string> = {
  xhs: '小红书',
  weibo: '微博',
  x: 'X (Twitter)',
  douyin: '抖音',
  website: 'ZenithJoyAI',
};

// Result status badge component
function ResultStatusBadge({ result, platform, isProcessing }: {
  result?: { success: boolean; url?: string; error?: string };
  platform: string;
  isProcessing: boolean;
}) {
  if (!result) {
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
        isProcessing
          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
          : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
      }`}>
        {isProcessing ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            发布中
          </>
        ) : (
          <>
            <Clock className="w-3 h-3" />
            待处理
          </>
        )}
      </span>
    );
  }

  if (result.success) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
        <CheckCircle2 className="w-3 h-3" />
        成功
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
      <XCircle className="w-3 h-3" />
      失败
    </span>
  );
}

// Platform status icons for list view
const platformEmojis: Record<string, string> = {
  xhs: '📕',
  weibo: '🟠',
  douyin: '🎵',
  website: '🌐',
  x: '𝕏',
};

// Result summary component (for list view) - shows each platform status inline
function ResultSummary({ task }: { task: PublishTask }) {
  const [showDetail, setShowDetail] = useState(false);

  if (!task.results || task.status === 'draft') {
    return <span className="text-gray-400 dark:text-gray-500 text-sm">-</span>;
  }

  const isProcessing = task.status === 'processing' || task.status === 'pending';

  return (
    <div className="relative">
      <div
        onClick={(e) => {
          e.stopPropagation();
          setShowDetail(!showDetail);
        }}
        className="flex flex-wrap items-center gap-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 px-1.5 py-1 rounded-lg -mx-1.5 transition-colors"
      >
        {task.targetPlatforms.map(platform => {
          const result = task.results?.[platform];
          const emoji = platformEmojis[platform] || platform.charAt(0).toUpperCase();

          // 状态：成功=绿色边框，失败=红色边框，处理中=蓝色脉冲，待处理=灰色
          let statusClass = 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700';
          let statusIcon = null;

          if (result?.success) {
            statusClass = 'border-green-400 bg-green-50 dark:bg-green-900/30';
            statusIcon = <CheckCircle2 className="w-2.5 h-2.5 text-green-500 absolute -bottom-0.5 -right-0.5" />;
          } else if (result && !result.success) {
            statusClass = 'border-red-400 bg-red-50 dark:bg-red-900/30';
            statusIcon = <XCircle className="w-2.5 h-2.5 text-red-500 absolute -bottom-0.5 -right-0.5" />;
          } else if (isProcessing) {
            statusClass = 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 animate-pulse';
          }

          return (
            <div
              key={platform}
              className={`relative w-7 h-7 rounded-lg border-2 flex items-center justify-center text-xs ${statusClass}`}
              title={`${platformDisplayNames[platform] || platform}: ${
                result?.success ? '成功' : result ? '失败' : isProcessing ? '发布中' : '待处理'
              }${result?.error ? ` - ${result.error}` : ''}`}
            >
              <span>{emoji}</span>
              {statusIcon}
            </div>
          );
        })}
      </div>

      {/* Hover/Click popup with details */}
      {showDetail && (
        <div
          className="absolute z-20 top-full left-0 mt-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl p-4 min-w-[280px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">发布结果详情</div>
          <div className="space-y-2">
            {task.targetPlatforms.map(platform => {
              const result = task.results?.[platform];
              return (
                <div key={platform} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-slate-700 last:border-0">
                  <span className="text-lg">{platformEmojis[platform]}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {platformDisplayNames[platform] || platform}
                    </div>
                    {result?.error && (
                      <div className="text-xs text-red-500 truncate max-w-[180px]">{result.error}</div>
                    )}
                    {result?.url && (
                      <a
                        href={result.url.split(' | ')[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline truncate block max-w-[180px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        查看链接 →
                      </a>
                    )}
                  </div>
                  <div>
                    {result?.success ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        <CheckCircle2 className="w-3 h-3" />
                        成功
                      </span>
                    ) : result ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                        <XCircle className="w-3 h-3" />
                        失败
                      </span>
                    ) : isProcessing ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        发布中
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-500">
                        <Clock className="w-3 h-3" />
                        待处理
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContentPublish() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [platforms, setPlatforms] = useState<PlatformSpec[]>([]);
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter and search state
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterPlatform, setFilterPlatform] = useState<FilterPlatform>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Batch operation state
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // Detail view state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<PublishTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Edit mode state (for draft tasks)
  const [editMode, setEditMode] = useState(false);
  const [editTitleZh, setEditTitleZh] = useState('');
  const [editTitleEn, setEditTitleEn] = useState('');
  const [editContentZh, setEditContentZh] = useState('');
  const [editContentEn, setEditContentEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [retryingPlatforms, setRetryingPlatforms] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);

  // Copy URL to clipboard
  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Enter edit mode
  const handleEnterEditMode = () => {
    if (!selectedTask) return;
    setEditTitleZh(selectedTask.titleZh || selectedTask.title);
    setEditTitleEn(selectedTask.titleEn || selectedTask.title);
    setEditContentZh(selectedTask.contentZh || selectedTask.content || '');
    setEditContentEn(selectedTask.contentEn || selectedTask.content || '');
    setEditMode(true);
  };

  // Cancel edit
  const handleCancelEdit = () => {
    setEditMode(false);
  };

  // Save draft edits
  const handleSaveDraftEdit = async () => {
    if (!selectedTask) return;

    setSaving(true);
    try {
      await publishApi.updateTask(selectedTask.id, {
        title: editTitleZh, // Use Chinese as primary title
        content: editContentZh || editContentEn,
      });
      await loadTaskDetail(selectedTask.id);
      setEditMode(false);
    } catch (error: any) {
      alert(error.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // Retry failed platform
  const handleRetryPlatform = async (platform: string) => {
    if (!selectedTask) return;

    setRetryingPlatforms(prev => new Set(prev).add(platform));
    try {
      await publishApi.retryPlatform(selectedTask.id, platform);
      await loadTaskDetail(selectedTask.id);
    } catch (error: any) {
      alert(error.response?.data?.message || '重试失败');
    } finally {
      setRetryingPlatforms(prev => {
        const newSet = new Set(prev);
        newSet.delete(platform);
        return newSet;
      });
    }
  };

  // Copy task as draft
  const handleCopyTask = async () => {
    if (!selectedTask) return;

    setCopying(true);
    try {
      const newTask = await publishApi.copyTask(selectedTask.id);
      // Navigate to the new task detail
      setSelectedTaskId(newTask.id);
      setSelectedTask(null);
      setViewMode('detail');
    } catch (error: any) {
      alert(error.response?.data?.message || '复制失败');
    } finally {
      setCopying(false);
    }
  };

  // Filter and paginate tasks
  const filteredAndPaginatedTasks = useMemo(() => {
    let filtered = tasks;

    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(task => task.status === filterStatus);
    }

    // Platform filter
    if (filterPlatform !== 'all') {
      filtered = filtered.filter(task => task.targetPlatforms.includes(filterPlatform));
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(task =>
        task.title.toLowerCase().includes(query) ||
        task.titleZh?.toLowerCase().includes(query) ||
        task.titleEn?.toLowerCase().includes(query) ||
        task.content?.toLowerCase().includes(query)
      );
    }

    // Calculate pagination
    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedTasks = filtered.slice(startIndex, endIndex);

    return {
      tasks: paginatedTasks,
      total: filtered.length,
      totalPages,
    };
  }, [tasks, filterStatus, filterPlatform, searchQuery, currentPage, itemsPerPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, filterPlatform, searchQuery]);

  // Batch operations
  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const toggleAllSelection = () => {
    if (selectedTaskIds.size === filteredAndPaginatedTasks.tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(filteredAndPaginatedTasks.tasks.map(t => t.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedTaskIds.size === 0) return;

    if (!confirm(`确定要删除选中的 ${selectedTaskIds.size} 个任务吗？`)) return;

    setIsBatchDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedTaskIds).map(id => publishApi.deleteTask(id))
      );
      setSelectedTaskIds(new Set());
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.message || '批量删除失败');
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const handleBatchPublish = async () => {
    if (selectedTaskIds.size === 0) return;

    // Only publish draft tasks
    const draftTasks = filteredAndPaginatedTasks.tasks.filter(
      t => selectedTaskIds.has(t.id) && t.status === 'draft'
    );

    if (draftTasks.length === 0) {
      alert('没有可发布的草稿任务');
      return;
    }

    if (!confirm(`确定要发布选中的 ${draftTasks.length} 个草稿任务吗？`)) return;

    try {
      await Promise.all(
        draftTasks.map(task => publishApi.submitTask(task.id))
      );
      setSelectedTaskIds(new Set());
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.message || '批量发布失败');
    }
  };

  // Form state - 双语内容
  const [titleZh, setTitleZh] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [contentZh, setContentZh] = useState('');
  const [contentEn, setContentEn] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('image');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [coverImage, setCoverImage] = useState<UploadedFile[]>([]); // 视频封面
  const [scheduleAt, setScheduleAt] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Load task detail
  const loadTaskDetail = useCallback(async (taskId: string) => {
    try {
      const task = await publishApi.getTask(taskId);
      setSelectedTask(task);
      return task;
    } catch (error) {
      console.error('Failed to load task detail:', error);
      return null;
    }
  }, []);

  // Initial data load
  useEffect(() => {
    loadData();
  }, []);

  // Polling for processing tasks
  useEffect(() => {
    if (viewMode !== 'detail' || !selectedTaskId) return;

    // Initial load
    setDetailLoading(true);
    loadTaskDetail(selectedTaskId).finally(() => setDetailLoading(false));

    // Poll only when processing or pending
    const shouldPoll = selectedTask?.status === 'processing' || selectedTask?.status === 'pending';
    if (!shouldPoll) return;

    const interval = setInterval(() => {
      loadTaskDetail(selectedTaskId);
    }, 10000); // 10 seconds

    return () => clearInterval(interval);
  }, [viewMode, selectedTaskId, selectedTask?.status, loadTaskDetail]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [platformsData, tasksData] = await Promise.all([
        publishApi.getPlatforms(),
        publishApi.getTasks({ limit: 50 }),
      ]);
      setPlatforms(platformsData);
      setTasks(tasksData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformToggle = (platformName: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platformName)
        ? prev.filter(p => p !== platformName)
        : [...prev, platformName]
    );
  };

  const handleSaveDraft = async () => {
    // 视频只需要一个标题，文章需要双语
    if (mediaType === 'video') {
      if (!titleZh.trim()) {
        alert('请输入视频标题');
        return;
      }
    } else {
      if (!titleZh.trim() || !titleEn.trim()) {
        alert('请输入中英文标题');
        return;
      }
    }
    if (selectedPlatforms.length === 0) {
      alert('请至少选择一个发布平台');
      return;
    }

    setSubmitting(true);
    try {
      await publishApi.createTask({
        titleZh,
        titleEn: mediaType === 'video' ? titleZh : titleEn, // 视频用同一个标题
        contentZh,
        contentEn: mediaType === 'video' ? contentZh : contentEn,
        mediaType,
        originalFiles: uploadedFiles.map(f => f.filePath),
        coverImage: coverImage.length > 0 ? coverImage[0].filePath : undefined,
        targetPlatforms: selectedPlatforms,
        scheduleAt: scheduleAt || undefined,
      });

      // Reset form and go back to list
      resetForm();
      setViewMode('list');
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishNow = async () => {
    // 视频只需要一个标题，文章需要双语
    if (mediaType === 'video') {
      if (!titleZh.trim()) {
        alert('请输入视频标题');
        return;
      }
    } else {
      if (!titleZh.trim() || !titleEn.trim()) {
        alert('请输入中英文标题');
        return;
      }
    }
    if (selectedPlatforms.length === 0) {
      alert('请至少选择一个发布平台');
      return;
    }

    setSubmitting(true);
    try {
      // Create and submit in one go
      const task = await publishApi.createTask({
        titleZh,
        titleEn: mediaType === 'video' ? titleZh : titleEn,
        contentZh,
        contentEn: mediaType === 'video' ? contentZh : contentEn,
        mediaType,
        originalFiles: uploadedFiles.map(f => f.filePath),
        coverImage: coverImage.length > 0 ? coverImage[0].filePath : undefined,
        targetPlatforms: selectedPlatforms,
      });

      await publishApi.submitTask(task.id);

      // Reset and reload
      resetForm();
      setViewMode('list');
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.message || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitTask = async (taskId: string) => {
    try {
      await publishApi.submitTask(taskId);
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.message || '提交失败');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('确定要删除这个发布任务吗？')) return;

    try {
      await publishApi.deleteTask(taskId);
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.message || '删除失败');
    }
  };

  const resetForm = () => {
    setTitleZh('');
    setTitleEn('');
    setContentZh('');
    setContentEn('');
    setMediaType('image');
    setSelectedPlatforms([]);
    setUploadedFiles([]);
    setCoverImage([]);
    setScheduleAt('');
  };

  // Enter detail view
  const handleViewDetail = (taskId: string) => {
    setSelectedTaskId(taskId);
    setSelectedTask(null);
    setViewMode('detail');
    setEditMode(false); // Reset edit mode
  };

  // Back to list
  const handleBackToList = () => {
    setViewMode('list');
    setSelectedTaskId(null);
    setSelectedTask(null);
    setEditMode(false); // Reset edit mode
    loadData(); // Refresh list
  };

  // Manual refresh detail
  const handleRefreshDetail = async () => {
    if (!selectedTaskId) return;
    setDetailLoading(true);
    await loadTaskDetail(selectedTaskId);
    setDetailLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // List view
  if (viewMode === 'list') {
    const allSelected = selectedTaskIds.size > 0 && selectedTaskIds.size === filteredAndPaginatedTasks.tasks.length;
    const someSelected = selectedTaskIds.size > 0;

    return (
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/25">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">内容发布</h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">创建和管理多平台内容分发</p>
            </div>
          </div>
          <button
            onClick={() => setViewMode('create')}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 magnetic-btn"
          >
            <Plus className="w-5 h-5" />
            创建发布
          </button>
        </div>

        {/* Filter Bar */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as FilterStatus)}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="pending">待发布</option>
                <option value="processing">发布中</option>
                <option value="completed">已完成</option>
                <option value="failed">失败</option>
                <option value="partial">部分成功</option>
              </select>
            </div>

            {/* Platform Filter */}
            <div>
              <select
                value={filterPlatform}
                onChange={e => setFilterPlatform(e.target.value as FilterPlatform)}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="all">全部平台</option>
                <option value="xhs">小红书</option>
                <option value="weibo">微博</option>
                <option value="douyin">抖音</option>
                <option value="website">网站</option>
              </select>
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索标题..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Results count */}
            <div className="text-sm text-gray-500 dark:text-gray-400">
              共 {filteredAndPaginatedTasks.total} 条
            </div>
          </div>
        </div>

        {/* Batch Operations Bar */}
        {someSelected && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-blue-700 dark:text-blue-400 font-medium">
                已选择 {selectedTaskIds.size} 项
              </span>
              <button
                onClick={() => setSelectedTaskIds(new Set())}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                取消选择
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchPublish}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Send className="w-4 h-4" />
                批量发布
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={isBatchDeleting}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                批量删除
              </button>
            </div>
          </div>
        )}

        {/* Tasks list */}
        {filteredAndPaginatedTasks.total === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
            <FileText className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {tasks.length === 0 ? '暂无发布任务' : '未找到匹配的任务'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {tasks.length === 0 ? '点击上方按钮创建第一个发布任务' : '尝试调整筛选条件'}
            </p>
            {tasks.length === 0 && (
              <button
                onClick={() => setViewMode('create')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 magnetic-btn"
              >
                <Plus className="w-5 h-5" />
                创建发布
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAllSelection}
                        className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">标题</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">类型</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">平台</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">状态</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">结果</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">创建时间</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {filteredAndPaginatedTasks.tasks.map(task => (
                    <tr
                      key={task.id}
                      onClick={() => handleViewDetail(task.id)}
                      className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                    >
                      <td className="w-12 px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedTaskIds.has(task.id)}
                          onChange={() => toggleTaskSelection(task.id)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 dark:text-white">{task.title}</div>
                        {task.content && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">{task.content}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                          {task.mediaType === 'image' && <ImageIcon className="w-4 h-4" />}
                          {task.mediaType === 'video' && <Film className="w-4 h-4" />}
                          {task.mediaType === 'text' && <FileText className="w-4 h-4" />}
                          {task.mediaType === 'image' ? '图文' : task.mediaType === 'video' ? '视频' : '文章'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1">
                          {task.targetPlatforms.map(p => (
                            <PlatformIcon key={p} platform={p} />
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <ResultSummary task={task} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(task.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewDetail(task.id);
                            }}
                            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                            title="查看详情"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {task.status === 'draft' && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSubmitTask(task.id);
                                }}
                                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                              >
                                发布
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTask(task.id);
                                }}
                                className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                              >
                                删除
                              </button>
                            </>
                          )}
                          {['completed', 'failed', 'partial'].includes(task.status) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(task.id);
                              }}
                              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {filteredAndPaginatedTasks.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  第 {currentPage} 页，共 {filteredAndPaginatedTasks.totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, filteredAndPaginatedTasks.totalPages) }, (_, i) => {
                      let pageNum;
                      if (filteredAndPaginatedTasks.totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= filteredAndPaginatedTasks.totalPages - 2) {
                        pageNum = filteredAndPaginatedTasks.totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                            currentPage === pageNum
                              ? 'bg-blue-600 text-white'
                              : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(filteredAndPaginatedTasks.totalPages, p + 1))}
                    disabled={currentPage === filteredAndPaginatedTasks.totalPages}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Detail view
  if (viewMode === 'detail') {
    const isProcessing = selectedTask?.status === 'processing' || selectedTask?.status === 'pending';

    return (
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToList}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/25">
                <Send className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">发布详情</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {selectedTask?.title || '加载中...'}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={handleRefreshDetail}
            disabled={detailLoading}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${detailLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {detailLoading && !selectedTask ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : selectedTask ? (
          <div className="space-y-6">
            {/* Progress Bar (if processing) */}
            {selectedTask.progress && selectedTask.status !== 'draft' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">发布进度</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedTask.progress.completed}/{selectedTask.progress.total} 平台
                    {selectedTask.progress.failed > 0 && (
                      <span className="text-red-500 ml-2">({selectedTask.progress.failed} 失败)</span>
                    )}
                  </span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      selectedTask.progress.failed > 0
                        ? 'bg-gradient-to-r from-green-500 to-orange-500'
                        : 'bg-gradient-to-r from-blue-500 to-green-500'
                    }`}
                    style={{ width: `${(selectedTask.progress.completed / selectedTask.progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Task Info Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">任务ID</div>
                  <div className="text-sm font-mono text-gray-900 dark:text-white truncate">
                    {selectedTask.id.slice(0, 8)}...
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">类型</div>
                  <div className="flex items-center gap-1 text-sm text-gray-900 dark:text-white">
                    {selectedTask.mediaType === 'image' && <ImageIcon className="w-4 h-4" />}
                    {selectedTask.mediaType === 'video' && <Film className="w-4 h-4" />}
                    {selectedTask.mediaType === 'text' && <FileText className="w-4 h-4" />}
                    {selectedTask.mediaType === 'image' ? '图文' : selectedTask.mediaType === 'video' ? '视频' : '文章'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">状态</div>
                  <StatusBadge status={selectedTask.status} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">发布人</div>
                  <div className="flex items-center gap-2">
                    {selectedTask.creatorAvatar ? (
                      <img src={selectedTask.creatorAvatar} alt="" className="w-5 h-5 rounded-full" />
                    ) : (
                      <User className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="text-sm text-gray-900 dark:text-white">
                      {selectedTask.creatorName || '未知'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">创建时间</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {new Date(selectedTask.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">更新时间</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {new Date(selectedTask.updatedAt).toLocaleString('zh-CN')}
                  </div>
                </div>
                {selectedTask.scheduleAt && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">定时发布</div>
                    <div className="text-sm text-gray-900 dark:text-white">
                      {new Date(selectedTask.scheduleAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Content Preview */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">内容预览</h3>
                {selectedTask.status === 'draft' && !editMode && (
                  <button
                    onClick={handleEnterEditMode}
                    className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                  >
                    <Edit className="w-4 h-4" />
                    编辑
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {/* Bilingual titles */}
                {editMode ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                        <span className="w-4 h-4 rounded bg-red-500 text-white text-[10px] flex items-center justify-center">中</span>
                        中文标题
                      </div>
                      <input
                        type="text"
                        value={editTitleZh}
                        onChange={e => setEditTitleZh(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    {selectedTask.mediaType !== 'video' && (
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded bg-blue-500 text-white text-[10px] flex items-center justify-center">EN</span>
                          English Title
                        </div>
                        <input
                          type="text"
                          value={editTitleEn}
                          onChange={e => setEditTitleEn(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                        <span className="w-4 h-4 rounded bg-red-500 text-white text-[10px] flex items-center justify-center">中</span>
                        中文标题
                      </div>
                      <div className="text-gray-900 dark:text-white font-medium">
                        {selectedTask.titleZh || selectedTask.title}
                      </div>
                    </div>
                    {selectedTask.titleEn && selectedTask.titleEn !== selectedTask.titleZh && (
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded bg-blue-500 text-white text-[10px] flex items-center justify-center">EN</span>
                          English Title
                        </div>
                        <div className="text-gray-900 dark:text-white font-medium">{selectedTask.titleEn}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Content */}
                {editMode ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">中文内容</div>
                      <textarea
                        value={editContentZh}
                        onChange={e => setEditContentZh(e.target.value)}
                        rows={6}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    {selectedTask.mediaType !== 'video' && (
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">English Content</div>
                        <textarea
                          value={editContentEn}
                          onChange={e => setEditContentEn(e.target.value)}
                          rows={6}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  (selectedTask.contentZh || selectedTask.content) && (
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">内容</div>
                      <div className="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {selectedTask.contentZh || selectedTask.content}
                      </div>
                    </div>
                  )
                )}

                {/* Save/Cancel buttons for edit mode */}
                {editMode && (
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleSaveDraftEdit}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      保存修改
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}

                {/* Media Preview */}
                {selectedTask.originalFiles && selectedTask.originalFiles.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      {selectedTask.mediaType === 'video' ? '视频' : '图片'} ({selectedTask.originalFiles.length})
                    </div>
                    <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                      {selectedTask.originalFiles.slice(0, 12).map((file, idx) => (
                        <a
                          key={idx}
                          href={publishApi.getFileUrl(file)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-700 hover:opacity-80 transition-opacity group"
                        >
                          {selectedTask.mediaType === 'video' ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <Film className="w-8 h-8 text-gray-400" />
                            </div>
                          ) : (
                            <img
                              src={publishApi.getFileUrl(file)}
                              alt={`Media ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <ExternalLink className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </a>
                      ))}
                      {selectedTask.originalFiles.length > 12 && (
                        <div className="aspect-square rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-500 text-sm">
                          +{selectedTask.originalFiles.length - 12}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Cover Image (for video) */}
                {selectedTask.coverImage && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">视频封面</div>
                    <img
                      src={publishApi.getFileUrl(selectedTask.coverImage)}
                      alt="Cover"
                      className="h-24 rounded-lg object-cover"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Publishing Results - Core Feature */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">发布结果</h3>
                {isProcessing && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    每 10 秒自动刷新
                  </span>
                )}
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      平台
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      状态
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      发布链接
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      错误信息
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {selectedTask.targetPlatforms.map(platform => {
                    const result = selectedTask.results?.[platform];
                    const isRetrying = retryingPlatforms.has(platform);
                    return (
                      <tr key={platform} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <PlatformIcon platform={platform} />
                            <span className="font-medium text-gray-900 dark:text-white">
                              {platformDisplayNames[platform] || platform}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <ResultStatusBadge
                            result={result}
                            platform={platform}
                            isProcessing={isProcessing}
                          />
                        </td>
                        <td className="px-6 py-4">
                          {result?.url ? (
                            <div className="flex flex-col gap-1">
                              {result.url.split(' | ').map((url, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
                                  >
                                    <span className="truncate max-w-[200px]">{url}</span>
                                  </a>
                                  <button
                                    onClick={() => handleCopyUrl(url)}
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                                    title="复制链接"
                                  >
                                    {copiedUrl === url ? (
                                      <Check className="w-3 h-3 text-green-500" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-gray-400 hover:text-gray-600" />
                                    )}
                                  </button>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                                    title="打开链接"
                                  >
                                    <ExternalLink className="w-3 h-3 text-gray-400 hover:text-blue-600" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500 text-sm">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {result?.error ? (
                            <span className="text-sm text-red-600 dark:text-red-400">
                              {result.error}
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500 text-sm">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {result && !result.success && (
                            <button
                              onClick={() => handleRetryPlatform(platform)}
                              disabled={isRetrying}
                              className="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300 disabled:opacity-50 ml-auto"
                              title="重试发布"
                            >
                              {isRetrying ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <RotateCcw className="w-4 h-4" />
                              )}
                              重试
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleBackToList}
                  className="px-6 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  返回列表
                </button>
                {selectedTask.status === 'draft' && !editMode && (
                  <button
                    onClick={async () => {
                      await handleSubmitTask(selectedTask.id);
                      await loadTaskDetail(selectedTask.id);
                    }}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 transition-all"
                  >
                    <Send className="w-5 h-5" />
                    发布
                  </button>
                )}
              </div>

              {/* Copy as Draft button */}
              {selectedTask.status !== 'draft' && (
                <button
                  onClick={handleCopyTask}
                  disabled={copying}
                  className="flex items-center gap-2 px-6 py-3 border-2 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
                >
                  {copying ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                  复制为草稿
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
            <XCircle className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">任务不存在</h3>
            <button
              onClick={handleBackToList}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              返回列表
            </button>
          </div>
        )}
      </div>
    );
  }

  // Create view
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => setViewMode('list')}
          className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/25">
            <Send className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">创建发布</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">填写内容并选择发布平台</p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* Media type selector */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">内容类型</label>
          <div className="flex gap-4">
            {[
              { type: 'image' as const, icon: ImageIcon, label: '图文' },
              { type: 'video' as const, icon: Film, label: '视频' },
            ].map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => setMediaType(type)}
                className={`
                  flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all magnetic-btn
                  ${mediaType === type
                    ? 'border-blue-600 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25'
                    : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500 text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 视频：单语输入 */}
        {mediaType === 'video' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">视频标题</label>
              <input
                type="text"
                value={titleZh}
                onChange={e => setTitleZh(e.target.value)}
                placeholder="输入视频标题..."
                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">视频描述（可选）</label>
              <textarea
                value={contentZh}
                onChange={e => setContentZh(e.target.value)}
                placeholder="输入视频描述..."
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
          </div>
        )}

        {/* 文章：双语输入 */}
        {mediaType !== 'video' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 中文版 */}
            <div className="space-y-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
              <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 text-white text-xs flex items-center justify-center shadow-lg shadow-red-500/25">中</span>
                中文版
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">标题</label>
                <input
                  type="text"
                  value={titleZh}
                  onChange={e => setTitleZh(e.target.value)}
                  placeholder="输入中文标题..."
                  className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">正文</label>
                <textarea
                  value={contentZh}
                  onChange={e => setContentZh(e.target.value)}
                  placeholder="输入中文正文..."
                  rows={6}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>
            </div>

            {/* 英文版 */}
            <div className="space-y-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
              <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs flex items-center justify-center shadow-lg shadow-blue-500/25">EN</span>
                English Version
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Title</label>
                <input
                  type="text"
                  value={titleEn}
                  onChange={e => setTitleEn(e.target.value)}
                  placeholder="Enter English title..."
                  className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Content</label>
                <textarea
                  value={contentEn}
                  onChange={e => setContentEn(e.target.value)}
                  placeholder="Enter English content..."
                  rows={6}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Media uploader (for image/video) */}
        {mediaType !== 'text' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              {mediaType === 'image' ? '上传图片' : '上传视频'}
            </label>
            <MediaUploader
              onFilesUploaded={setUploadedFiles}
              maxFiles={mediaType === 'video' ? 1 : 20}
              acceptedTypes={mediaType === 'video' ? ['video/*'] : ['image/*']}
            />
          </div>
        )}

        {/* Cover image uploader (for video only) */}
        {mediaType === 'video' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              视频封面（可选）
            </label>
            <MediaUploader
              onFilesUploaded={setCoverImage}
              maxFiles={1}
              acceptedTypes={['image/*']}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              如不上传封面，将使用视频第一帧作为封面
            </p>
          </div>
        )}

        {/* Platform selector */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">发布平台</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {platforms.map(platform => (
              <button
                key={platform.name}
                onClick={() => handlePlatformToggle(platform.name)}
                className={`
                  flex items-center gap-3 p-4 rounded-xl border-2 transition-all
                  ${selectedPlatforms.includes(platform.name)
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500 bg-gray-50 dark:bg-slate-700'
                  }
                `}
              >
                <PlatformIcon platform={platform.name} />
                <div className="text-left">
                  <div className="font-medium text-gray-900 dark:text-white">{platform.displayName}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {mediaType === 'image' && `最多 ${platform.maxImages} 张图`}
                    {mediaType === 'video' && `最长 ${Math.floor(platform.videoSpecs.maxDuration / 60)} 分钟`}
                    {mediaType === 'text' && (platform.contentLimit > 0 ? `${platform.contentLimit} 字` : '无限制')}
                  </div>
                </div>
                {selectedPlatforms.includes(platform.name) && (
                  <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400 ml-auto" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <Calendar className="w-4 h-4 inline mr-1" />
            定时发布（可选）
          </label>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={e => setScheduleAt(e.target.value)}
            className="w-full sm:w-auto px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-6">
          <button
            onClick={handlePublishNow}
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed magnetic-btn"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
            立即发布
          </button>
          <button
            onClick={handleSaveDraft}
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-3 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-5 h-5" />
            保存草稿
          </button>
          <button
            onClick={() => {
              resetForm();
              setViewMode('list');
            }}
            disabled={submitting}
            className="px-6 py-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
