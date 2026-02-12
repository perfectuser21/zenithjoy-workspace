/**
 * ToAPI 平台适配器（Google VEO3）
 */

import { VideoPlatform, type UnifiedVideoParams, type UnifiedTask, type PlatformModel } from './base';

const TOAPI_BASE_URL = 'https://toapis.com/v1';

interface ToAPIRequest {
  model: string;
  prompt: string;
  duration: number;
  aspect_ratio: string;
  image_urls?: string[];
  metadata?: Record<string, any>;
}

interface ToAPITask {
  id: string;
  model: string;
  status: string;
  progress?: number;
  created_at?: number;
  completed_at?: number;
  video_url?: string;
  error?: { code?: string; message?: string; };
}

function getApiToken(): string {
  const token = import.meta.env.VITE_TOAPIS_API_KEY;
  if (!token) {
    throw new Error('ToAPI API key not configured');
  }
  return token;
}

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

  private mapToToAPIRequest(params: UnifiedVideoParams): ToAPIRequest {
    return {
      model: params.model,
      prompt: params.prompt,
      duration: 8,
      aspect_ratio: params.aspectRatio || '16:9',
      image_urls: params.imageUrls,
      metadata: {
        generation_type: params.imageUrls?.length === 2 ? 'frame' : 'reference',
        resolution: params.resolution,
      },
    };
  }

  private mapToUnifiedTask(task: ToAPITask): UnifiedTask {
    let status: UnifiedTask['status'] = 'queued';
    let progress = 0;

    switch (task.status) {
      case 'queued':
        status = 'queued';
        progress = 0;
        break;
      case 'in_progress':
      case 'processing':
        status = 'in_progress';
        progress = task.progress || 50;
        break;
      case 'completed':
      case 'success':
        status = 'completed';
        progress = 100;
        break;
      case 'failed':
      case 'error':
        status = 'failed';
        progress = 0;
        break;
    }

    return {
      id: task.id,
      platform: this.id,
      model: task.model,
      status,
      progress,
      created_at: task.created_at,
      completed_at: task.completed_at,
      videoUrl: task.video_url,
      error: task.error,
    };
  }

  async createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask> {
    const validation = this.validateParams(params);
    if (!validation.valid) {
      throw new Error(`Invalid params: ${validation.error}`);
    }

    const requestBody = this.mapToToAPIRequest(params);
    console.log('[ToAPI] Creating video generation:', requestBody);

    const response = await fetch(`${TOAPI_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiToken()}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[ToAPI] Create error:', error);
      throw new Error(`ToAPI error: ${response.status} - ${error}`);
    }

    const task: ToAPITask = await response.json();
    console.log('[ToAPI] Response:', task);

    return this.mapToUnifiedTask(task);
  }

  async getTaskStatus(taskId: string): Promise<UnifiedTask> {
    console.log('[ToAPI] Getting task status:', taskId);

    const response = await fetch(`${TOAPI_BASE_URL}/videos/generations/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${getApiToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`ToAPI error: ${response.status}`);
    }

    const responseData = await response.json();
    console.log('[ToAPI] Task status response:', responseData);

    // ⚠️ CRITICAL FIX: ToAPI returns {code, message, data} wrapper when polling
    let task: ToAPITask;
    if (responseData.code === 'success' && responseData.data) {
      task = responseData.data;
      console.log('[ToAPI] Unwrapped task:', task);
    } else {
      task = responseData;
      console.log('[ToAPI] Direct task:', task);
    }

    return this.mapToUnifiedTask(task);
  }
}
