import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { useWorkDetail } from '../hooks/useWorkDetail';
import { useAutoSave } from '../hooks/useAutoSave';
import { TipTapEditor } from '../components/works/TipTapEditor';
import { MediaUploader } from '../components/works/MediaUploader';
import { CustomFieldsEditor } from '../components/works/CustomFieldsEditor';
import type { ContentType, WorkStatus, Account, UpdateWorkInput } from '../api/works.api';

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // 本地编辑状态 (必须在 early return 之前声明所有 hooks)
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [status, setStatus] = useState<WorkStatus>('draft');
  const [account, setAccount] = useState<Account>('XXIP');
  const [contentText, setContentText] = useState('');
  const [mediaFiles, setMediaFiles] = useState<Array<{ url: string; type: 'image' | 'video' }>>([]);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  // Hooks 必须在条件返回之前调用
  const { work, isLoading, error, updateWork, isUpdating } = useWorkDetail(id || '');

  // 初始化编辑状态
  useEffect(() => {
    if (work) {
      setTitle(work.title);
      setContentType(work.content_type);
      setStatus(work.status);
      setAccount(work.account);
      setContentText(work.content_text || '');
      setMediaFiles(work.media_files || []);
      setCustomFields(work.custom_fields || {});
    }
  }, [work]);

  // 准备更新数据
  const getUpdates = (): UpdateWorkInput => ({
    title,
    content_type: contentType,
    status,
    account,
    content_text: contentText,
    media_files: mediaFiles,
    custom_fields: customFields,
  });

  // 自动保存
  const { isSaving, lastSaved, triggerSave } = useAutoSave({
    data: getUpdates(),
    onSave: async (updates) => {
      updateWork(updates);
    },
    delay: 2000,
    enabled: !!work,
  });

  // Ctrl+S 保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        triggerSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerSave]);

  // ID 检查（在所有 hooks 之后）
  if (!id) {
    useEffect(() => {
      navigate('/works');
    }, [navigate]);
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-4">加载失败</p>
          <button
            onClick={() => navigate('/works')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  if (!work) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/works')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>返回</span>
          </button>

          <div className="flex items-center gap-4">
            {/* 保存状态 */}
            <div className="text-sm text-gray-500">
              {isSaving || isUpdating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  保存中...
                </span>
              ) : lastSaved ? (
                <span>已保存 {lastSaved.toLocaleTimeString()}</span>
              ) : null}
            </div>

            {/* 手动保存按钮 */}
            <button
              onClick={triggerSave}
              disabled={isSaving || isUpdating}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
            >
              <Save className="w-4 h-4" />
              保存
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Metadata */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-medium"
              placeholder="作品标题"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as ContentType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="text">长文</option>
                <option value="image">图片</option>
                <option value="video">视频</option>
                <option value="article">文章</option>
                <option value="audio">音频</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkStatus)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="draft">草稿</option>
                <option value="pending">待发布</option>
                <option value="published">已发布</option>
                <option value="archived">已归档</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">账号</label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value as Account)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="XXIP">XXIP</option>
                <option value="XXAI">XXAI</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm text-gray-500">
            <div>
              <span className="font-medium">创建：</span>
              {new Date(work.created_at).toLocaleDateString()}
            </div>
            <div>
              <span className="font-medium">更新：</span>
              {new Date(work.updated_at).toLocaleDateString()}
            </div>
            {work.first_published_at && (
              <div>
                <span className="font-medium">发布：</span>
                {new Date(work.first_published_at).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        {/* Rich Text Editor */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">正文内容</h3>
          <TipTapEditor
            content={contentText}
            onChange={setContentText}
          />
        </div>

        {/* Media Uploader */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">媒体文件</h3>
          <MediaUploader
            files={mediaFiles}
            onChange={setMediaFiles}
          />
        </div>

        {/* Custom Fields */}
        <CustomFieldsEditor
          fields={customFields}
          onChange={setCustomFields}
        />
      </div>
    </div>
  );
}
