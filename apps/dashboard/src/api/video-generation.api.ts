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

// 获取 API Token（从环境变量读取）
function getApiToken(): string {
  const token = import.meta.env.VITE_TOAPIS_API_KEY;
  if (!token) {
    throw new Error('ToAPI API Key not configured. Please set VITE_TOAPIS_API_KEY in environment variables.');
  }
  return token;
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
 * 上传图片到 VPS 服务器
 */
export async function uploadImage(file: File): Promise<ImageUploadResponse> {
  // 转换为 base64
  const base64 = await fileToBase64(file);

  // 调用上传 API（N8N webhook）
  const response = await fetch('/api/n8n-webhook/upload-video-frame', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      base64: base64,
      size: file.size,
    }),
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 将 File 转换为 base64
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:image/xxx;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
