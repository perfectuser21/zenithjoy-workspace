import { useRef, useState } from 'react';
import { X, Image as ImageIcon } from 'lucide-react';

interface ImageUploaderProps {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

export default function ImageUploader({ label, value, onChange, disabled = false }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB');
      return;
    }

    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => setPreviewUrl(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
      onChange(dataUrl);
      setError('⚠️ 图片已选择，但需要配置图片上传服务才能使用');
    } catch (err) {
      setError('上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      {previewUrl ? (
        <div className="relative group">
          <img src={previewUrl} alt="Preview" className="w-full h-40 object-cover rounded-xl border" />
          <button
            type="button"
            onClick={() => { setPreviewUrl(null); onChange(null); }}
            disabled={disabled}
            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="w-full h-40 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 hover:border-blue-400"
        >
          {uploading ? (
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <ImageIcon className="w-6 h-6 text-slate-400" />
              <div className="text-sm">点击上传图片</div>
            </>
          )}
        </button>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      {error && <div className="mt-2 text-sm text-amber-600">{error}</div>}
    </div>
  );
}
