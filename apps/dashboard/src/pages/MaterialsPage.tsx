/**
 * 素材库
 *
 * 素材从三个入口进来（iPhone 快捷指令 / 小程序 / 电脑 agent），全部落进同一个池子。
 * 这一页是它们第一次变得"看得见"——在此之前素材传上去只有查库和列桶才能确认，
 * 等于没交付。
 *
 * 两条刻意的取舍（decision 1a20f778）：
 *  ① 预览地址 1 小时有效，不做自动续签。开着超过 1 小时刷新页面即可。
 *  ② 视频只显示图标 + 文件名，不出缩略图——抽帧转码要 ffmpeg + 异步任务 +
 *     缩略图存储，是独立的一件事，硬塞进来会把这一刀撑成两周。
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Film, X, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  listMaterials,
  isVideo,
  formatSize,
  type Material,
} from '../api/materials.api';

const PAGE_SIZE = 60;

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 单个格子。预览地址为 null 时显示占位，绝不把 null 塞进 img src 渲染成破图。 */
function Tile({ item, onOpen }: { item: Material; onOpen: (m: Material) => void }) {
  const video = isVideo(item);
  const canPreview = !video && Boolean(item.preview_url);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group relative aspect-square overflow-hidden rounded-lg bg-gray-100 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
      title={item.file_name}
    >
      {canPreview ? (
        <img
          src={item.preview_url as string}
          alt={item.file_name}
          loading="lazy"
          className="h-full w-full object-cover transition group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-400">
          {video ? <Film className="h-8 w-8" /> : <AlertTriangle className="h-7 w-7" />}
          <span className="px-2 text-center text-[11px] leading-tight">
            {video ? '视频' : '预览不可用'}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
        <div className="truncate text-[11px] text-white">{item.file_name}</div>
        <div className="text-[10px] text-white/70">
          {formatSize(item.size_bytes)}
          {item.taken_at ? ` · ${formatTime(item.taken_at)}` : ''}
        </div>
      </div>
    </button>
  );
}

/** 点开看大图。视频不内嵌播放器——第一版只给下载入口，播放是另一件事。 */
function Lightbox({ item, onClose }: { item: Material; onClose: () => void }) {
  const video = isVideo(item);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="presentation"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()} role="presentation">
        {!video && item.preview_url ? (
          <img src={item.preview_url} alt={item.file_name} className="max-h-[80vh] rounded-lg object-contain" />
        ) : (
          <div className="rounded-lg bg-gray-900 px-8 py-12 text-center text-gray-300">
            {video ? <Film className="mx-auto h-12 w-12" /> : <AlertTriangle className="mx-auto h-12 w-12" />}
            <p className="mt-3 text-sm">
              {video ? '视频暂不支持在线预览' : '这条素材的预览地址签发失败'}
            </p>
          </div>
        )}
        <div className="mt-3 text-center text-sm text-white">
          <div className="font-medium">{item.file_name}</div>
          <div className="text-white/60">
            {formatSize(item.size_bytes)}
            {item.taken_at ? ` · 拍摄于 ${formatTime(item.taken_at)}` : ''}
            {` · 上传于 ${formatTime(item.created_at)}`}
          </div>
          {item.preview_url ? (
            <a
              href={item.preview_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-blue-300 underline"
            >
              打开原文件
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MaterialsPage() {
  const [opened, setOpened] = useState<Material | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['materials', PAGE_SIZE],
    queryFn: () => listMaterials({ limit: PAGE_SIZE }),
    // 预览地址 1 小时过期，缓存别留太久，免得回到这页全是破图
    staleTime: 5 * 60 * 1000,
  });

  const items = data?.items ?? [];

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">素材库</h1>
          <p className="mt-1 text-sm text-gray-500">
            手机快捷指令、小程序、电脑上传的素材都在这里
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400">加载中…</div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : '加载素材失败'}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-16 text-center">
          <ImageIcon className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">还没有素材</p>
          <p className="mt-1 text-xs text-gray-400">
            用 iPhone 快捷指令或电脑上传后，会出现在这里
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {items.map((m) => (
              <Tile key={m.id} item={m} onOpen={setOpened} />
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-400">
            共 {items.length} 条{items.length >= PAGE_SIZE ? '（只显示最近的）' : ''}
          </p>
        </>
      )}

      {opened ? <Lightbox item={opened} onClose={() => setOpened(null)} /> : null}
    </div>
  );
}
