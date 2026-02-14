/**
 * AI 视频生成类型定义
 *
 * 注：使用平台抽象层的统一类型
 */

// 重新导出平台抽象层类型
export type { UnifiedTask, UnifiedVideoParams, PlatformModel } from '../api/platforms';

// 兼容旧类型（别名）
export type VideoGenerationTask = import('../api/platforms').UnifiedTask;
export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

// 视频模型 ID（ToAPI 平台）
export type VideoModel = 'veo3.1-fast' | 'veo3.1-quality';

// 视频参数
export type VideoDuration = 8; // ToAPI 固定 8 秒
export type VideoResolution = '720p' | '1080p' | '4k';
export type AspectRatio = '16:9' | '9:16';

// 图片上传响应
export interface ImageUploadResponse {
  url: string;
  filename: string;
  size: number;
}
