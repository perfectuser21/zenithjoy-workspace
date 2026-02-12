/**
 * AI 视频生成 API
 * 基于 ToAPI 平台
 */

import type {
  CreateVideoRequest,
  CreateVideoResponse,
  GetTaskResponse,
  ImageUploadResponse,
  VideoGenerationTask,
  TaskStatus
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

  const toApiResponse = await response.json();

  // ToAPI 返回 {code, data} 结构，需要解包
  if (toApiResponse.code === 'success' && toApiResponse.data) {
    return mapToAPIResponse(toApiResponse.data);
  }

  throw new Error(`ToAPI error: ${toApiResponse.code || 'Unknown error'}`);
}

/**
 * 映射 ToAPI 响应到前端类型
 * 处理字段名和状态值的差异
 * @internal - Exported for testing
 */
export function mapToAPIResponse(rawResponse: any): GetTaskResponse {
  console.log('[ToAPI Debug] Raw response (after unwrap):', JSON.stringify(rawResponse, null, 2));

  // ToAPI 返回大写状态值: SUCCESS, FAILED, PROCESSING
  const status = rawResponse.status || rawResponse.state;

  // 处理状态值差异（包括大写）
  const statusMap: Record<string, TaskStatus> = {
    // ToAPI 大写格式
    'SUCCESS': 'completed',
    'FAILED': 'failed',
    'PROCESSING': 'in_progress',
    // 其他可能的格式
    'pending': 'queued',
    'queued': 'queued',
    'processing': 'in_progress',
    'in_progress': 'in_progress',
    'completed': 'completed',
    'success': 'completed',
    'failed': 'failed',
    'error': 'failed',
  };

  const mappedStatus: TaskStatus = statusMap[status] || 'queued';

  // 解析进度: "100%" -> 100
  let progress = 0;
  if (typeof rawResponse.progress === 'string') {
    progress = parseInt(rawResponse.progress.replace('%', '')) || 0;
  } else {
    progress = rawResponse.progress || 0;
  }

  // ToAPI bug: 视频 URL 在 fail_reason 字段
  let result = rawResponse.result;
  if (rawResponse.fail_reason && typeof rawResponse.fail_reason === 'string' && rawResponse.fail_reason.startsWith('http')) {
    result = { video_url: rawResponse.fail_reason };
  }

  console.log('[ToAPI Debug] Status mapping:', {
    raw: status,
    mapped: mappedStatus,
    progress: { raw: rawResponse.progress, parsed: progress },
    result: result
  });

  return {
    id: rawResponse.task_id || rawResponse.id,
    object: rawResponse.object || 'generation.task',
    status: mappedStatus,
    progress,
    created_at: rawResponse.created_at,
    completed_at: rawResponse.completed_at,
    error: rawResponse.error,
    result,
  };
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

  const toApiResponse = await response.json();

  // ToAPI 返回 {code, data} 结构，需要解包
  if (toApiResponse.code === 'success' && toApiResponse.data) {
    return mapToAPIResponse(toApiResponse.data);
  }

  throw new Error(`ToAPI error: ${toApiResponse.code || 'Unknown error'}`);
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
