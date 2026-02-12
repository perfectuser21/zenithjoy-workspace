/**
 * AI 视频生成类型定义
 */

// 支持的 AI 模型
export type VideoModel =
  | 'MiniMax-Hailuo-02'
  | 'Sora-2'
  | 'Vail-3'
  | 'Douyin-VideoGen'
  | 'Luma-1.6';

// 视频时长（秒）
export type VideoDuration = 5 | 10;

// 视频分辨率
export type VideoResolution = '512p' | '768p' | '1080p';

// 任务状态
export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

// 模型配置
export interface ModelConfig {
  id: VideoModel;
  name: string;
  description: string;
  maxDuration: VideoDuration;
  supportedResolutions: VideoResolution[];
  supportFirstFrame: boolean;
  supportLastFrame: boolean;
}

// 视频生成参数
export interface VideoGenerationParams {
  model: VideoModel;
  prompt: string;
  duration?: VideoDuration;
  metadata?: {
    resolution?: VideoResolution;
    prompt_optimizer?: boolean;
    fast_pretreatment?: boolean;
    watermark?: boolean;
    first_frame_image?: string;
    last_frame_image?: string;
  };
}

// 任务响应
export interface VideoGenerationTask {
  id: string;
  object: 'generation.task';
  status: TaskStatus;
  progress: number;
  created_at: number;
  completed_at?: number;
  error?: {
    message: string;
    code?: string;
  };
  result?: {
    video_url: string;
    thumbnail_url?: string;
    duration: number;
    resolution: string;
  };
}

// API 请求
export interface CreateVideoRequest {
  model: VideoModel;
  prompt: string;
  duration?: VideoDuration;
  metadata?: VideoGenerationParams['metadata'];
}

// API 响应
export interface CreateVideoResponse {
  id: string;
  object: 'generation.task';
  status: TaskStatus;
  progress: number;
  created_at: number;
}

// 查询任务响应
export type GetTaskResponse = VideoGenerationTask;

// 图片上传响应
export interface ImageUploadResponse {
  url: string;
  filename: string;
  size: number;
}
