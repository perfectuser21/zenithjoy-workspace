/**
 * AI 视频生成 API
 * 基于 ToAPI 平台
 */

import type {
  CreateVideoRequest,
  CreateVideoResponse,
  GetTaskResponse,
  ImageUploadResponse,
  VideoGenerationTask
} from '../types/video-generation.types';

// ToAPI 基础 URL
const TOAPI_BASE_URL = 'https://toapis.com/v1';

// 获取 API Token（从环境变量或配置）
function getApiToken(): string {
  // TODO: 从环境变量或凭据管理系统读取
  // 暂时使用占位符，实际使用时需要配置
  return process.env.TOAPI_TOKEN || '';
}

/**
 * 创建视频生成任务
 */
export async function createVideoGeneration(
  params: CreateVideoRequest
): Promise<CreateVideoResponse> {
  const response = await fetch(`${TOAPI_BASE_URL}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiToken()}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * 查询任务状态
 */
export async function getTaskStatus(taskId: string): Promise<GetTaskResponse> {
  const response = await fetch(`${TOAPI_BASE_URL}/videos/generations/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getApiToken()}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * 轮询任务状态直到完成或失败
 */
export async function pollTaskStatus(
  taskId: string,
  onProgress: (task: VideoGenerationTask) => void,
  interval: number = 3000,
  timeout: number = 300000
): Promise<VideoGenerationTask> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        if (Date.now() - startTime > timeout) {
          reject(new Error('Task timeout'));
          return;
        }

        const task = await getTaskStatus(taskId);
        onProgress(task);

        if (task.status === 'completed') {
          resolve(task);
          return;
        }

        if (task.status === 'failed') {
          reject(new Error(task.error?.message || 'Task failed'));
          return;
        }

        setTimeout(poll, interval);
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });
}

/**
 * 上传图片到服务器
 * TODO: 实现图片上传逻辑
 */
export async function uploadImage(file: File): Promise<ImageUploadResponse> {
  throw new Error('Image upload not implemented. Please configure an image hosting service.');
}
