/**
 * ToAPI 平台适配器
 *
 * 实现 ToAPI 视频生成 API 的平台适配
 * 文档: https://docs.toapis.com/docs/cn/api-reference/videos/veo3/generation
 */

import { VideoPlatform, type UnifiedVideoParams, type UnifiedTask, type PlatformModel } from './base';

// ToAPI 基础 URL
const TOAPI_BASE_URL = 'https://toapis.com/v1';

// 获取 API Token
function getApiToken(): string {
  const token = import.meta.env.VITE_TOAPIS_API_KEY;
  if (!token) {
    throw new Error('ToAPI API Key not configured. Please set VITE_TOAPIS_API_KEY in environment variables.');
  }
  return token;
}

/**
 * ToAPI 平台特定的请求参数
 */
interface ToAPIRequest {
  model: string;
  prompt: string;
  duration: number;
  aspect_ratio: string;
  image_urls?: string[];
  metadata?: {
    generation_type?: 'frame' | 'reference';
    resolution?: string;
    enable_gif?: boolean;
  };
}

/**
 * ToAPI 平台特定的响应格式
 */
interface ToAPIResponse {
  id: string;
  object: string;
  model: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  created_at: number;
  completed_at?: number;
  metadata?: any;
  result?: {
    video_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * ToAPI 平台实现
 */
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
      }
    },
    {
      id: 'veo3.1-quality',
      name: 'VEO 3.1 Quality',
      description: 'Google VEO3 高质量模式 - 8秒高质量视频',
      capabilities: {
        fixedDuration: 8,
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p', '4k'],
        supportImages: true,
        maxImages: 2,  // quality 模式不支持 reference 类型（3张图）
      }
    }
  ];

  /**
   * 映射统一参数到 ToAPI 格式
   */
  private mapToToAPIRequest(params: UnifiedVideoParams): ToAPIRequest {
    const model = this.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    // ToAPI 要求固定 8 秒
    const duration = model.capabilities.fixedDuration || 8;

    // 宽高比映射
    const aspectRatio = params.aspectRatio || '16:9';

    // 图片生成类型
    let generationType: 'frame' | 'reference' | undefined;
    if (params.imageUrls && params.imageUrls.length > 0) {
      generationType = params.imageUrls.length === 2 ? 'frame' : 'reference';
    }

    return {
      model: params.model,
      prompt: params.prompt,
      duration,
      aspect_ratio: aspectRatio,
      image_urls: params.imageUrls,
      metadata: {
        generation_type: generationType,
        resolution: params.resolution,
        enable_gif: false,
      }
    };
  }

  /**
   * 映射 ToAPI 响应到统一格式
   */
  private mapToUnifiedTask(response: ToAPIResponse, platform: string = this.id): UnifiedTask {
    return {
      id: response.id,
      platform,
      model: response.model,
      status: response.status,
      progress: response.progress || 0,
      created_at: response.created_at,
      completed_at: response.completed_at,
      videoUrl: response.result?.video_url,
      error: response.error,
    };
  }

  /**
   * 创建视频生成任务
   */
  async createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask> {
    // 验证参数
    const validation = this.validateParams(params);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 映射参数
    const toApiRequest = this.mapToToAPIRequest(params);

    console.log('[ToAPI] Creating video generation:', toApiRequest);

    // 发送请求
    const response = await fetch(`${TOAPI_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiToken()}`,
      },
      body: JSON.stringify(toApiRequest),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `ToAPI HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[ToAPI] Response:', data);

    return this.mapToUnifiedTask(data);
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string): Promise<UnifiedTask> {
    console.log('[ToAPI] Getting task status:', taskId);

    const response = await fetch(`${TOAPI_BASE_URL}/videos/generations/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getApiToken()}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `ToAPI HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[ToAPI] Task status:', data);

    return this.mapToUnifiedTask(data);
  }
}
