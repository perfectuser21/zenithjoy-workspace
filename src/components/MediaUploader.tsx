import React, { useCallback, useState } from 'react';
import { Upload, X, Film, Loader2, ZoomIn } from 'lucide-react';
import type { UploadedFile } from '../api/publish.api';
import { publishApi } from '../api/publish.api';

interface MediaUploaderProps {
  onFilesUploaded: (files: UploadedFile[]) => void;
  maxFiles?: number;
  acceptedTypes?: string[];
  className?: string;
}

export default function MediaUploader({
  onFilesUploaded,
  maxFiles = 20,
  acceptedTypes = ['image/*', 'video/*'],
  className = '',
}: MediaUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    // Check file count limit
    if (uploadedFiles.length + files.length > maxFiles) {
      setError(`最多只能上传 ${maxFiles} 个文件`);
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const uploaded = await publishApi.uploadFiles(files);
      const newFiles = [...uploadedFiles, ...uploaded];
      setUploadedFiles(newFiles);
      onFilesUploaded(newFiles);
    } catch (err: any) {
      setError(err.response?.data?.message || '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }, [uploadedFiles, maxFiles, onFilesUploaded]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUpload(Array.from(e.target.files));
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    handleUpload(files);
  }, [handleUpload]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const removeFile = (index: number) => {
    const newFiles = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(newFiles);
    onFilesUploaded(newFiles);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // 计算图片比例
  const getAspectRatio = (width?: number, height?: number): string => {
    if (!width || !height) return '';
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    const w = width / divisor;
    const h = height / divisor;

    // 常见比例映射
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.05) return '1:1';
    if (Math.abs(ratio - 16/9) < 0.05) return '16:9';
    if (Math.abs(ratio - 9/16) < 0.05) return '9:16';
    if (Math.abs(ratio - 4/3) < 0.05) return '4:3';
    if (Math.abs(ratio - 3/4) < 0.05) return '3:4';
    if (Math.abs(ratio - 4/5) < 0.05) return '4:5';
    if (Math.abs(ratio - 5/4) < 0.05) return '5:4';

    // 如果不是常见比例，显示简化的比例
    if (w <= 20 && h <= 20) return `${w}:${h}`;
    return `${(ratio).toFixed(2)}:1`;
  };

  // 根据比例判断适合的平台
  const getPlatformFit = (width?: number, height?: number): string[] => {
    if (!width || !height) return [];
    const ratio = width / height;
    const fits: string[] = [];

    // 小红书: 3:4, 1:1, 4:3
    if (Math.abs(ratio - 3/4) < 0.1 || Math.abs(ratio - 1) < 0.1 || Math.abs(ratio - 4/3) < 0.1) {
      fits.push('小红书');
    }
    // 抖音: 9:16, 3:4, 1:1
    if (Math.abs(ratio - 9/16) < 0.1 || Math.abs(ratio - 3/4) < 0.1 || Math.abs(ratio - 1) < 0.1) {
      fits.push('抖音');
    }
    // X: 16:9, 1:1, 4:5
    if (Math.abs(ratio - 16/9) < 0.1 || Math.abs(ratio - 1) < 0.1 || Math.abs(ratio - 4/5) < 0.1) {
      fits.push('X');
    }
    // 微博/网站: 任意比例
    fits.push('微博', '网站');

    return fits;
  };

  return (
    <div className={className}>
      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
          ${dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          }
        `}
      >
        <input
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileChange}
          className="hidden"
          id="file-upload"
          disabled={uploading}
        />
        <label htmlFor="file-upload" className="cursor-pointer">
          {uploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
              <p className="text-gray-600">正在上传...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <Upload className="w-12 h-12 text-gray-400 mb-4" />
              <p className="text-gray-600 mb-2">
                拖拽文件到这里，或<span className="text-blue-600 font-medium">点击上传</span>
              </p>
              <p className="text-gray-400 text-sm">
                支持图片和视频，单个文件最大 1GB
              </p>
            </div>
          )}
        </label>
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Uploaded files preview */}
      {uploadedFiles.length > 0 && (
        <div className="mt-6 space-y-4">
          <h4 className="text-sm font-medium text-gray-700">
            已上传 ({uploadedFiles.length}/{maxFiles})
          </h4>
          {uploadedFiles.map((file, index) => {
            const aspectRatio = getAspectRatio(file.width, file.height);
            const platformFit = getPlatformFit(file.width, file.height);

            return (
              <div
                key={file.id}
                className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200"
              >
                {/* Thumbnail */}
                <div
                  className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-200 cursor-pointer relative group"
                  onClick={() => file.mimeType.startsWith('image/') && setPreviewImage(publishApi.getFileUrl(file.filePath))}
                >
                  {file.mimeType.startsWith('image/') ? (
                    <>
                      <img
                        src={publishApi.getFileUrl(file.thumbnail || file.filePath)}
                        alt={file.originalName}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ZoomIn className="w-6 h-6 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-8 h-8 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900 truncate">{file.originalName}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(file.fileSize)}</p>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>

                  {/* Aspect ratio & dimensions */}
                  {file.width && file.height && (
                    <div className="mt-2 flex items-center gap-3">
                      <span className="px-2 py-1 bg-gray-900 text-white text-xs font-mono rounded">
                        {aspectRatio}
                      </span>
                      <span className="text-xs text-gray-500">
                        {file.width} × {file.height}
                      </span>
                    </div>
                  )}

                  {/* Platform compatibility */}
                  {platformFit.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">适合:</span>
                      {platformFit.map(p => (
                        <span key={p} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
