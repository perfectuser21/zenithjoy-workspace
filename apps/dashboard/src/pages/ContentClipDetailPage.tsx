import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClip, retryClip } from '../api/content-clipper.api';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy}
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
      {copied ? '已复制' : '复制'}
    </button>
  );
}

const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书' };
const OUTPUT_STATUS_LABEL: Record<string, string> = {
  pending: '待推送', pushed: '已推送', failed: '推送失败', skipped: '无输出配置',
};
const OUTPUT_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  pushed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};

export default function ContentClipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [ocrExpanded, setOcrExpanded] = useState(false);

  const { data: clip, isLoading, isError } = useQuery({
    queryKey: ['clips', 'detail', id],
    queryFn: () => getClip(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === 'pending' || d.status === 'processing') return 5_000;
      // 图文：status=done 但 OCR 还没写入时继续轮询
      if (d.status === 'done' && d.content_type === '图文' && !d.ocr_text) return 3_000;
      return false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => retryClip(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clips', 'detail', id] });
      qc.invalidateQueries({ queryKey: ['clips', 'list'] });
    },
  });

  if (isLoading) return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-48 bg-gray-200 rounded" />
      </div>
    </div>
  );

  if (isError || !clip) return (
    <div className="max-w-3xl mx-auto p-6 text-center">
      <p className="text-gray-500">找不到该记录</p>
      <button onClick={() => navigate('/clips')} className="mt-4 text-blue-600 hover:underline text-sm">
        返回列表
      </button>
    </div>
  );

  const images: string[] = Array.isArray(clip.images) ? clip.images as string[] : [];
  const PREVIEW_LEN = 500;
  const transcriptPreview = clip.transcript ? clip.transcript.slice(0, PREVIEW_LEN) : null;
  const transcriptLong = clip.transcript ? clip.transcript.length > PREVIEW_LEN : false;
  const ocrPreview = clip.ocr_text ? clip.ocr_text.slice(0, PREVIEW_LEN) : null;
  const ocrLong = clip.ocr_text ? clip.ocr_text.length > PREVIEW_LEN : false;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <button onClick={() => navigate('/clips')}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1">
        ← 返回列表
      </button>

      <div className="flex items-start gap-4 mb-6">
        {clip.cover_url && (
          <img src={clip.cover_url} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold mb-1">{clip.title || '无标题'}</h1>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{PLATFORM_LABEL[clip.platform] || clip.platform}</span>
            {clip.author && <span>@{clip.author}</span>}
            {clip.like_count != null && <span>❤️ {clip.like_count.toLocaleString()}</span>}
          </div>
          <a href={clip.url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline mt-1 block truncate">
            {clip.url}
          </a>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
          clip.status === 'done' ? 'bg-green-100 text-green-700' :
          clip.status === 'failed' ? 'bg-red-100 text-red-700' :
          clip.status === 'processing' ? 'bg-blue-100 text-blue-700' :
          'bg-yellow-100 text-yellow-700'
        }`}>
          {clip.status === 'done' ? '采集完成' : clip.status === 'failed' ? '采集失败' :
           clip.status === 'processing' ? '处理中' : '等待中'}
        </span>
        {clip.output_status && clip.output_url && (
          <span className={`text-xs px-2 py-1 rounded-full ${OUTPUT_STATUS_BADGE[clip.output_status] || 'bg-gray-100 text-gray-500'}`}>
            {clip.output_type === 'notion' ? 'Notion' : '飞书'} · {OUTPUT_STATUS_LABEL[clip.output_status] || clip.output_status}
          </span>
        )}
        {clip.status === 'failed' && (
          <button onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}
            className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded px-3 py-1 hover:bg-orange-100 transition-colors">
            {retryMutation.isPending ? '重试中...' : '重试'}
          </button>
        )}
      </div>

      {clip.status === 'failed' && clip.error_msg && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6 text-sm text-red-700">
          {clip.error_msg}
        </div>
      )}

      {clip.ocr_text && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">图文文字（OCR）</h2>
            <CopyButton text={clip.ocr_text} />
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {ocrExpanded ? clip.ocr_text : (ocrPreview || '')}
            {ocrLong && !ocrExpanded && '...'}
          </p>
          {ocrLong && (
            <button onClick={() => setOcrExpanded(!ocrExpanded)}
              className="text-xs text-blue-600 hover:underline mt-2">
              {ocrExpanded ? '收起' : `展开全文（${clip.ocr_text.length} 字）`}
            </button>
          )}
        </div>
      )}

      {clip.transcript && (
        <div className="bg-gray-50 border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">转写文案</h2>
            <CopyButton text={clip.transcript} />
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {transcriptExpanded ? clip.transcript : (transcriptPreview || '')}
            {transcriptLong && !transcriptExpanded && '...'}
          </p>
          {transcriptLong && (
            <button onClick={() => setTranscriptExpanded(!transcriptExpanded)}
              className="text-xs text-blue-600 hover:underline mt-2">
              {transcriptExpanded ? '收起' : `展开全文（${clip.transcript.length} 字）`}
            </button>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">图片</h2>
          <div className="grid grid-cols-3 gap-2">
            {images.slice(0, 9).map((src: string, i: number) => (
              <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                <img src={src} alt="" className="w-full aspect-square object-cover rounded-lg hover:opacity-90 transition-opacity" />
              </a>
            ))}
          </div>
          {images.length > 9 && (
            <p className="text-xs text-gray-400 mt-2">还有 {images.length - 9} 张图片</p>
          )}
        </div>
      )}
    </div>
  );
}
