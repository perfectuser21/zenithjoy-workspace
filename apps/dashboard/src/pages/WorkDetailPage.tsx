import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Save, Loader2,
  CheckCircle2, XCircle, Clock, RefreshCw,
  FileText, Send, BarChart3, Newspaper,
  ExternalLink,
} from 'lucide-react';
import { useWorkDetail } from '../hooks/useWorkDetail';
import { useAutoSave } from '../hooks/useAutoSave';
import { TipTapEditor } from '../components/works/TipTapEditor';
import { MediaUploader } from '../components/works/MediaUploader';
import { CustomFieldsEditor } from '../components/works/CustomFieldsEditor';
import { getPublishLogs } from '../api/works.api';
import type { ContentType, WorkStatus, Account, UpdateWorkInput, PublishLog } from '../api/works.api';

// ============ 常量 ============

const PLATFORM_NAMES: Record<string, string> = {
  douyin: '抖音',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  weibo: '微博',
  bilibili: 'B站',
  toutiao: '今日头条',
  channels: '视频号',
  zhihu: '知乎',
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  text: '长文',
  image: '图文',
  video: '视频',
  article: '文章',
  audio: '音频',
};

// ============ 全链路 Tab 组件 ============

interface WorkSummary {
  title: string;
  content_type: string;
  created_at: string;
  media_files?: Array<{ url: string; type: string }>;
  custom_fields?: Record<string, unknown>;
  first_published_at?: string;
}

function PipelineTab({ workId, work }: { workId: string; work: WorkSummary }) {
  const { data: publishLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['publish-logs', workId],
    queryFn: () => getPublishLogs(workId),
    refetchInterval: 30_000,
  });

  const getStatusIcon = (status: string) => {
    if (status === 'published' || status === 'success') {
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    }
    if (status === 'failed') {
      return <XCircle className="w-4 h-4 text-red-500" />;
    }
    if (status === 'publishing') {
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    }
    return <Clock className="w-4 h-4 text-yellow-500" />;
  };

  const getStatusLabel = (status: string): string => {
    const map: Record<string, string> = {
      published: '已发布',
      success: '已发布',
      failed: '发布失败',
      publishing: '发布中',
      scheduled: '计划中',
      pending: '待发布',
    };
    return map[status] ?? status;
  };

  const getStatusBorderColor = (status: string): string => {
    if (status === 'published' || status === 'success') return 'border-l-green-400';
    if (status === 'failed') return 'border-l-red-400';
    if (status === 'publishing') return 'border-l-blue-400';
    return 'border-l-yellow-400';
  };

  const extractMetrics = (log: PublishLog) => {
    const r = log.response as Record<string, unknown> | null;
    if (!r) return null;
    const views = r.views ?? r.view_count ?? r.play_count ?? null;
    const likes = r.likes ?? r.like_count ?? r.digg_count ?? null;
    const comments = r.comments ?? r.comment_count ?? null;
    const shares = r.shares ?? r.share_count ?? null;
    if (views === null && likes === null) return null;
    return { views, likes, comments, shares };
  };

  const publishedCount = publishLogs.filter(
    (l) => l.status === 'published' || l.status === 'success'
  ).length;

  const hasMetrics = publishLogs.some((l) => extractMetrics(l) !== null);

  return (
    <div className="space-y-6">
      {/* 进度概览 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '内容生成', done: true, Icon: FileText },
          { label: '平台发布', done: publishedCount > 0, Icon: Send },
          { label: '数据采集', done: hasMetrics, Icon: BarChart3 },
          { label: '日报汇总', done: false, Icon: Newspaper },
        ].map((step) => (
          <div
            key={step.label}
            className={`rounded-lg border p-4 flex flex-col items-center gap-2 text-center ${
              step.done ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <step.Icon className={`w-5 h-5 ${step.done ? 'text-green-600' : 'text-gray-400'}`} />
            <span className={`text-xs font-medium ${step.done ? 'text-green-800' : 'text-gray-500'}`}>
              {step.label}
            </span>
            {step.done
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <Clock className="w-3.5 h-3.5 text-gray-300" />
            }
          </div>
        ))}
      </div>

      {/* 阶段一：内容生成 */}
      <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 bg-green-50 border-b border-green-100">
          <FileText className="w-4 h-4 text-green-600" />
          <span className="font-semibold text-green-800 text-sm">阶段一：内容生成</span>
          <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-400 text-xs mb-1">关键词 / 标题</p>
            <p className="font-medium text-gray-900 line-clamp-2">{work.title}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">内容类型</p>
            <p className="font-medium text-gray-900">
              {CONTENT_TYPE_LABELS[work.content_type] ?? work.content_type}
            </p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">生成时间</p>
            <p className="font-medium text-gray-900">
              {new Date(work.created_at).toLocaleString('zh-CN')}
            </p>
          </div>
          {work.media_files && work.media_files.length > 0 && (
            <div>
              <p className="text-gray-400 text-xs mb-1">媒体文件</p>
              <p className="font-medium text-gray-900">{work.media_files.length} 个文件</p>
            </div>
          )}
          {!!work.custom_fields?.nas_path && (
            <div className="col-span-2">
              <p className="text-gray-400 text-xs mb-1">NAS 路径</p>
              <p className="font-mono text-xs text-gray-600 break-all">
                {String(work.custom_fields.nas_path)}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 阶段二：平台发布 */}
      <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <Send className={`w-4 h-4 ${publishedCount > 0 ? 'text-green-600' : 'text-gray-400'}`} />
          <span className={`font-semibold text-sm ${publishedCount > 0 ? 'text-green-800' : 'text-gray-700'}`}>
            阶段二：平台发布
          </span>
          <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            {logsLoading ? '加载中...' : `${publishedCount} / ${publishLogs.length} 平台成功`}
          </span>
        </div>

        {logsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : publishLogs.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">暂无发布记录</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {publishLogs.map((log) => {
              const metrics = extractMetrics(log);
              return (
                <div
                  key={log.id}
                  className={`px-5 py-3 flex items-start gap-3 border-l-4 ${getStatusBorderColor(log.status)}`}
                >
                  <div className="mt-0.5 flex-shrink-0">{getStatusIcon(log.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">
                        {PLATFORM_NAMES[log.platform] ?? log.platform}
                      </span>
                      <span className="text-xs text-gray-500">{getStatusLabel(log.status)}</span>
                      {log.platform_post_id && (
                        <span className="text-xs text-gray-300 font-mono">
                          ID: {log.platform_post_id.slice(0, 12)}…
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                      {log.published_at && (
                        <span>{new Date(log.published_at).toLocaleString('zh-CN')}</span>
                      )}
                      {log.error_message && (
                        <span className="text-red-400 truncate max-w-xs">{log.error_message}</span>
                      )}
                    </div>
                    {metrics && (
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-600">
                        {metrics.views !== null && <span>播放 {String(metrics.views)}</span>}
                        {metrics.likes !== null && <span>点赞 {String(metrics.likes)}</span>}
                        {metrics.comments !== null && <span>评论 {String(metrics.comments)}</span>}
                        {metrics.shares !== null && <span>分享 {String(metrics.shares)}</span>}
                      </div>
                    )}
                  </div>
                  {log.platform_url && (
                    <a
                      href={log.platform_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:text-blue-600 flex-shrink-0 mt-0.5"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 阶段三：数据采集 */}
      <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <BarChart3 className={`w-4 h-4 ${hasMetrics ? 'text-green-600' : 'text-gray-400'}`} />
          <span className={`font-semibold text-sm ${hasMetrics ? 'text-green-800' : 'text-gray-700'}`}>
            阶段三：数据采集
          </span>
          <span className="ml-auto text-xs text-gray-400">每日自动抓取</span>
        </div>

        {!hasMetrics ? (
          <div className="px-5 py-6 text-center">
            <Clock className="w-7 h-7 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">数据采集中，发布后 24h 内完成首次抓取</p>
            <p className="text-xs text-gray-300 mt-1">系统自动采集 1/3/5/7/15/30 天数据</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {publishLogs
              .filter((l) => extractMetrics(l) !== null)
              .map((log) => {
                const metrics = extractMetrics(log)!;
                const items = [
                  { label: '播放量', value: metrics.views },
                  { label: '点赞', value: metrics.likes },
                  { label: '评论', value: metrics.comments },
                  { label: '分享', value: metrics.shares },
                ].filter((m) => m.value !== null);
                return (
                  <div key={log.id} className="px-5 py-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">
                      {PLATFORM_NAMES[log.platform] ?? log.platform}
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {items.map((m) => (
                        <div key={m.label} className="bg-gray-50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-gray-900">{String(m.value)}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* 阶段四：日报汇总 */}
      <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <Newspaper className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-sm text-gray-600">阶段四：日报汇总</span>
        </div>
        <div className="px-5 py-6 text-center">
          <Newspaper className="w-7 h-7 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">日报由 Cecelia 每日汇总生成</p>
          <p className="text-xs text-gray-300 mt-1">汇总该作品在所有平台的表现</p>
        </div>
      </section>
    </div>
  );
}

// ============ 主组件 ============

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'edit' | 'pipeline'>('edit');
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [status, setStatus] = useState<WorkStatus>('draft');
  const [account, setAccount] = useState<Account>('XXIP');
  const [contentText, setContentText] = useState('');
  const [mediaFiles, setMediaFiles] = useState<Array<{ url: string; type: 'image' | 'video' }>>([]);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const { work, isLoading, error, updateWork, isUpdating } = useWorkDetail(id || '');

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

  const getUpdates = (): UpdateWorkInput => ({
    title,
    content_type: contentType,
    status,
    account,
    content_text: contentText,
    media_files: mediaFiles,
    custom_fields: customFields,
  });

  const { isSaving, lastSaved, triggerSave } = useAutoSave({
    data: getUpdates(),
    onSave: async (updates) => { updateWork(updates); },
    delay: 2000,
    enabled: !!work && activeTab === 'edit',
  });

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

  useEffect(() => {
    if (!id) navigate('/works');
  }, [id, navigate]);

  if (!id) return null;

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

  if (!work) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/works')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>返回</span>
          </button>

          {/* Tab 切换 */}
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg p-1 bg-gray-50">
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                activeTab === 'edit'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              编辑
            </button>
            <button
              onClick={() => setActiveTab('pipeline')}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                activeTab === 'pipeline'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              全链路
            </button>
          </div>

          {/* 编辑 Tab 的保存操作 */}
          {activeTab === 'edit' && (
            <div className="flex items-center gap-4 ml-auto">
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
              <button
                onClick={triggerSave}
                disabled={isSaving || isUpdating}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 text-sm"
              >
                <Save className="w-4 h-4" />
                保存
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === 'edit' ? (
          <div className="space-y-6">
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

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">正文内容</h3>
              <TipTapEditor content={contentText} onChange={setContentText} />
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">媒体文件</h3>
              <MediaUploader files={mediaFiles} onChange={setMediaFiles} />
            </div>

            <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />
          </div>
        ) : (
          <PipelineTab workId={id} work={work} />
        )}
      </div>
    </div>
  );
}
