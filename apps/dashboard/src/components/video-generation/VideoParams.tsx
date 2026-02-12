import type { VideoDuration, VideoResolution } from '../../types/video-generation.types';

interface VideoParamsProps {
  duration: VideoDuration;
  resolution: VideoResolution;
  promptOptimizer: boolean;
  fastPretreatment: boolean;
  watermark: boolean;
  onDurationChange: (duration: VideoDuration) => void;
  onResolutionChange: (resolution: VideoResolution) => void;
  onPromptOptimizerChange: (enabled: boolean) => void;
  onFastPretreatmentChange: (enabled: boolean) => void;
  onWatermarkChange: (enabled: boolean) => void;
  disabled?: boolean;
  maxDuration?: VideoDuration;
}

export default function VideoParams(props: VideoParamsProps) {
  const durationOptions: VideoDuration[] = [5, 10];
  const resolutionOptions: VideoResolution[] = ['512p', '768p', '1080p'];

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">视频时长</label>
        <div className="flex gap-2">
          {durationOptions.map((d) => (
            <button
              key={d}
              onClick={() => props.onDurationChange(d)}
              disabled={props.disabled || d > (props.maxDuration || 10)}
              className={`flex-1 px-4 py-2 rounded-xl font-medium ${props.duration === d ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {d} 秒
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-2">分辨率</label>
        <div className="flex gap-2">
          {resolutionOptions.map((r) => (
            <button
              key={r}
              onClick={() => props.onResolutionChange(r)}
              disabled={props.disabled || (r === '1080p' && props.duration === 10)}
              className={`flex-1 px-4 py-2 rounded-xl font-medium ${props.resolution === r ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Toggle label="提示词优化器" checked={props.promptOptimizer} onChange={props.onPromptOptimizerChange} disabled={props.disabled} />
        <Toggle label="快速预处理" checked={props.fastPretreatment} onChange={props.onFastPretreatmentChange} disabled={props.disabled} />
        <Toggle label="水印" checked={props.watermark} onChange={props.onWatermarkChange} disabled={props.disabled} />
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
      <span className="text-sm font-medium">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full ${checked ? 'bg-blue-500' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}
