/**
 * ToAPI 平台适配器（Google VEO3）
 *
 * 架构说明：
 * - 前端通过后端 API 代理访问 ToAPI，不直接持有 API Key
 * - API Key 安全存储在后端环境变量中
 * - 所有 ToAPI 调用由后端统一管理
 */

import { VideoPlatform, type UnifiedVideoParams, type UnifiedTask, type PlatformModel } from './base';
import { aiVideoApi } from '../ai-video.api';

// No longer needed - API Key is managed by backend

export class ToAPIPlatform extends VideoPlatform {
  readonly id = 'toapi';
  readonly name = 'ToAPI';

  readonly models: PlatformModel[] = [
    {
      id: 'veo3.1-fast',
      name: 'VEO 3.1 Fast',
      description: 'Google VEO3 快速模式 - 8秒视频生成',
      capabilities: {
        fixedDuration: 8,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p', '4k'],
        supportImages: true,
        maxImages: 2,
      },
    },
    {
      id: 'veo3.1-quality',
      name: 'VEO 3.1 Quality',
      description: 'Google VEO3 高质量模式 - 8秒视频生成',
      capabilities: {
        fixedDuration: 8,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p', '4k'],
        supportImages: true,
        maxImages: 2,
      },
    },
  ];

// Mapping functions no longer needed - backend handles ToAPI response parsing

  async createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask> {
    const validation = this.validateParams(params);
    if (!validation.valid) {
      throw new Error(`Invalid params: ${validation.error}`);
    }

    console.log('[ToAPI] Creating video generation via backend:', params);

    // Call backend API (which proxies to ToAPI)
    const generation = await aiVideoApi.createGeneration({
      platform: this.id,
      model: params.model,
      prompt: params.prompt,
      duration: 8,  // ToAPI fixed duration
      aspect_ratio: params.aspectRatio || '16:9',
      resolution: params.resolution,
      image_urls: params.imageUrls,
    });

    console.log('[ToAPI] Backend response:', generation);

    // Map backend response to UnifiedTask
    return {
      id: generation.id,
      platform: generation.platform,
      model: generation.model,
      status: generation.status,
      progress: generation.progress,
      created_at: generation.created_at ? new Date(generation.created_at).getTime() / 1000 : undefined,
      completed_at: generation.completed_at ? new Date(generation.completed_at).getTime() / 1000 : undefined,
      videoUrl: generation.video_url,
      error: generation.error_message ? { message: generation.error_message } : undefined,
    };
  }

  async getTaskStatus(taskId: string): Promise<UnifiedTask> {
    console.log('[ToAPI] Getting task status via backend:', taskId);

    // Call backend API (which syncs from ToAPI)
    const generation = await aiVideoApi.getGenerationById(taskId);
    console.log('[ToAPI] Backend response:', generation);

    // Map backend response to UnifiedTask
    return {
      id: generation.id,
      platform: generation.platform,
      model: generation.model,
      status: generation.status,
      progress: generation.progress,
      created_at: generation.created_at ? new Date(generation.created_at).getTime() / 1000 : undefined,
      completed_at: generation.completed_at ? new Date(generation.completed_at).getTime() / 1000 : undefined,
      videoUrl: generation.video_url,
      error: generation.error_message ? { message: generation.error_message } : undefined,
    };
  }
}
