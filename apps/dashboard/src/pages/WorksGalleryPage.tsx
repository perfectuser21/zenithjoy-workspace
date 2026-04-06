import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { getWorks, type Work, type ContentType } from '../api/works.api';

// ============ 类型 ============

interface WorkItem {
  id: string;
  title: string;
  body: string;
  tags: string[];
  imageUrl: string;
  contentType: ContentType;
}

// ============ 数据转换 ============

function workToItem(work: Work): WorkItem {
  const keyword = work.custom_fields?.keyword as string | undefined;
  const tags: string[] = [];
  if (keyword) tags.push(keyword);

  const imageUrl = work.media_files?.[0]?.url ?? '';

  return {
    id: work.id,
    title: work.title,
    body: work.content_text ?? '',
    tags,
    imageUrl,
    contentType: work.content_type,
  };
}

// ============ 类型标签映射 ============

const TYPE_LABELS: Record<ContentType, string> = {
  text: '文本',
  image: '图文',
  video: '视频',
  article: '长文',
  audio: '音频',
};

// ============ 右侧滑出面板（Notion 风格） ============

function SlidePanel({
  item,
  items,
  onClose,
  onNavigate,
}: {
  item: WorkItem;
  items: WorkItem[];
  onClose: () => void;
  onNavigate: (item: WorkItem) => void;
}) {
  const currentIndex = items.indexOf(item);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowUp' && currentIndex > 0) onNavigate(items[currentIndex - 1]);
      if (e.key === 'ArrowDown' && currentIndex < items.length - 1) onNavigate(items[currentIndex + 1]);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentIndex, items, onClose, onNavigate]);

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* 右侧面板 */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] md:w-[540px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col animate-slide-in-right">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            {currentIndex > 0 && (
              <button
                onClick={() => onNavigate(items[currentIndex - 1])}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <span className="text-xs text-slate-400">
              {currentIndex + 1} / {items.length}
            </span>
            {currentIndex < items.length - 1 && (
              <button
                onClick={() => onNavigate(items[currentIndex + 1])}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {/* 图片（有封面才展示） */}
          {item.imageUrl && (
            <div className="p-5">
              <img
                src={item.imageUrl}
                alt={item.title}
                className="w-full rounded-xl shadow-lg"
              />
            </div>
          )}

          {/* 标题 + 标签 */}
          <div className="px-5 pb-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {item.title}
            </h2>
            {item.tags.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 分割线 */}
          <div className="mx-5 border-t border-slate-100 dark:border-slate-800" />

          {/* 正文 */}
          {item.body && (
            <div className="px-5 py-4">
              <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">
                {item.body}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ============ 懒加载图片 ============

function LazyImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const imgRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className={className}>
      {inView && (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
        />
      )}
      {(!inView || !loaded) && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-xl" />
      )}
    </div>
  );
}

// ============ 主页面 ============

export default function WorksGalleryPage() {
  const [typeFilter, setTypeFilter] = useState<ContentType | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['works-gallery', typeFilter],
    queryFn: () => getWorks({
      limit: 100,
      offset: 0,
      sort: 'created_at',
      order: 'desc',
      ...(typeFilter ? { type: typeFilter } : {}),
    }),
  });

  const allItems: WorkItem[] = useMemo(() => {
    return (data?.data ?? []).map(workToItem);
  }, [data]);

  // 收集所有出现的 content_type 作为动态筛选标签
  const availableTypes: ContentType[] = useMemo(() => {
    const seen = new Set<ContentType>();
    (data?.data ?? []).forEach((w: Work) => seen.add(w.content_type));
    return Array.from(seen);
  }, [data]);

  const handleCardClick = useCallback((item: WorkItem) => {
    setSelectedItem(item);
  }, []);

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
            <Image className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          作品库
        </h1>
        <p className="text-slate-500 dark:text-slate-400 ml-13">
          {isLoading ? '加载中…' : `${allItems.length} 件作品`}
        </p>
      </div>

      {/* 类型筛选（动态，仅在有数据时显示） */}
      {availableTypes.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {availableTypes.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === type
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {TYPE_LABELS[type] ?? type}
            </button>
          ))}
          {typeFilter && (
            <button
              onClick={() => setTypeFilter(null)}
              className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              清除
            </button>
          )}
        </div>
      )}

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="flex items-center justify-center py-20">
          <p className="text-red-500 dark:text-red-400">加载失败：{String(error)}</p>
        </div>
      )}

      {/* 空状态 */}
      {!isLoading && !error && allItems.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <p className="text-slate-400 dark:text-slate-500">
            作品库暂无内容，Cecelia 生成内容后将自动显示
          </p>
        </div>
      )}

      {/* 卡片网格 */}
      {!isLoading && !error && allItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {allItems.map((item) => (
            <div
              key={item.id}
              onClick={() => handleCardClick(item)}
              className="group cursor-pointer"
            >
              <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 shadow-sm group-hover:shadow-lg transition-all duration-300 group-hover:-translate-y-1">
                {item.imageUrl ? (
                  <LazyImage
                    src={item.imageUrl}
                    alt={item.title}
                    className="absolute inset-0"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Image className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  </div>
                )}
              </div>
              <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                {item.title}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Notion 风格右侧滑出面板 */}
      {selectedItem && (
        <SlidePanel
          item={selectedItem}
          items={allItems}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
        />
      )}
    </div>
  );
}
