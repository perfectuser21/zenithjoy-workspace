/**
 * AI 视频生成类型定义（多平台支持）
 */

// ==================== 平台相关类型 ====================

// 支持的平台
export type VideoPlatform = 'toapi' | 'replicate' | 'runwayml';

// 宽高比
export type AspectRatio = '16:9' | '9:16' | '1:1';

// 视频分辨率
export type VideoResolution = '720p' | '1080p' | '4k';

// 任务状态
export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

// ==================== 统一的任务类型 ====================

/**
 * 视频生成任务（统一格式）
 */
export interface VideoGenerationTask {
  id: string;
  platform: string;
  model: string;
  status: TaskStatus;
  progress: number;
  created_at?: number;
  completed_at?: number;
  videoUrl?: string;
  error?: {
    code?: string;
    message: string;
  };
}

/**
 * 图片上传响应
 */
export interface ImageUploadResponse {
  url: string;
  filename: string;
  size: number;
}

// ==================== 向后兼容的类型（已废弃） ====================

/**
 * @deprecated 使用统一的平台模型 ID 替代
 */
export type VideoModel =
  | 'MiniMax-Hailuo-02'
  | 'Sora-2'
  | 'Vail-3'
  | 'Douyin-VideoGen'
  | 'Luma-1.6'
  | 'veo3.1-fast'
  | 'veo3.1-quality';

/**
 * @deprecated 使用 AspectRatio 替代
 */
export type VideoDuration = 5 | 8 | 10;

/**
 * @deprecated 使用新的 PlatformModel 类型
 */
export interface ModelConfig {
  id: VideoModel;
  name: string;
  description: string;
  maxDuration: VideoDuration;
  supportedResolutions: VideoResolution[];
  supportFirstFrame: boolean;
  supportLastFrame: boolean;
}

/**
 * @deprecated 使用 UnifiedVideoParams 替代
 */
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

/**
 * @deprecated 使用 UnifiedVideoParams 替代
 */
export interface CreateVideoRequest {
  model: VideoModel;
  prompt: string;
  duration?: VideoDuration;
  metadata?: VideoGenerationParams['metadata'];
}

/**
 * @deprecated 使用 VideoGenerationTask 替代
 */
export interface CreateVideoResponse {
  id: string;
  object: 'generation.task';
  status: TaskStatus;
  progress: number;
  created_at: number;
}

/**
 * @deprecated 使用 VideoGenerationTask 替代
 */
export type GetTaskResponse = VideoGenerationTask;
