/**
 * ToAPI 客户端 - 安全代理 ToAPI 视频生成服务
 *
 * 架构说明：
 * - API Key 只在后端持有，前端完全不知道
 * - 所有 ToAPI 调用由后端统一管理
 * - 支持 Google VEO3 视频生成模型
 */

const TOAPI_BASE_URL = 'https://toapis.com/v1';

interface ToAPIRequest {
  model: string;
  prompt: string;
  duration: number;
  aspect_ratio: string;
  image_urls?: string[];
  metadata?: Record<string, unknown>;
}

interface ToAPITask {
  id: string;
  model: string;
  status: string;
  progress?: number;
  created_at?: number;
  completed_at?: number;
  video_url?: string;
  fail_reason?: string;  // ToAPI bug: video URL sometimes appears here
  error?: { code?: string; message?: string; };
}

interface ToAPIResponse {
  code?: string;
  message?: string;
  data?: ToAPITask;
}

/**
 * 获取 ToAPI API Key（从环境变量）
 *
 * 安全说明：
 * - 使用 TOAPI_API_KEY（不带 VITE_ 前缀）
 * - 只在后端读取，前端无法访问
 * - 支持从 ~/.credentials/toapi.env 加载
 */
function getApiToken(): string {
  const token = process.env.TOAPI_API_KEY;
  if (!token) {
    throw new Error('TOAPI_API_KEY not configured in environment variables');
  }
  return token;
}

/**
 * 标准化状态映射
 */
function normalizeStatus(status: string): 'queued' | 'in_progress' | 'completed' | 'failed' {
  const normalized = status.toLowerCase();

  switch (normalized) {
    case 'queued':
      return 'queued';
    case 'in_progress':
    case 'processing':
      return 'in_progress';
    case 'completed':
    case 'success':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      console.warn(`[ToAPI] Unknown status: ${status}, defaulting to queued`);
      return 'queued';
  }
}

/**
 * 提取视频 URL（处理 ToAPI 的 bug）
 */
function extractVideoUrl(task: ToAPITask): string | undefined {
  // 优先使用 video_url 字段
  if (task.video_url) {
    return task.video_url;
  }

  // ToAPI bug: 有时视频 URL 在 fail_reason 字段中
  if (task.fail_reason?.startsWith('http')) {
    console.warn('[ToAPI] Video URL found in fail_reason field (ToAPI bug)');
    return task.fail_reason;
  }

  return undefined;
}

export class ToAPIClient {
  /**
   * 创建视频生成任务
   *
   * @param params 视频生成参数
   * @returns ToAPI 任务信息
   */
  async createVideoGeneration(params: {
    model: string;
    prompt: string;
    duration?: number;
    aspectRatio?: string;
    resolution?: string;
    imageUrls?: string[];
  }): Promise<{
    id: string;
    model: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    progress: number;
    created_at?: number;
  }> {
    const requestBody: ToAPIRequest = {
      model: params.model,
      prompt: params.prompt,
      duration: params.duration || 8,
      aspect_ratio: params.aspectRatio || '16:9',
      image_urls: params.imageUrls,
      metadata: {
        generation_type: params.imageUrls?.length === 2 ? 'frame' : 'reference',
        resolution: params.resolution,
      },
    };

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

    const task = await response.json() as ToAPITask;
    console.log('[ToAPI] Response:', task);

    return {
      id: task.id,
      model: task.model,
      status: normalizeStatus(task.status),
      progress: task.progress || 0,
      created_at: task.created_at,
    };
  }

  /**
   * 查询视频生成任务状态
   *
   * @param taskId ToAPI 任务 ID
   * @returns 任务状态信息
   */
  async getTaskStatus(taskId: string): Promise<{
    id: string;
    model: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    progress: number;
    video_url?: string;
    error_message?: string;
    created_at?: number;
    completed_at?: number;
  }> {
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

    const responseData = await response.json() as ToAPITask | ToAPIResponse;
    console.log('[ToAPI] Task status response:', responseData);

    // ⚠️ CRITICAL FIX: ToAPI returns {code, message, data} wrapper when polling
    let task: ToAPITask;
    if ('code' in responseData && responseData.code === 'success' && responseData.data) {
      task = responseData.data;
      console.log('[ToAPI] Unwrapped task:', task);
    } else {
      task = responseData as ToAPITask;
      console.log('[ToAPI] Direct task:', task);
    }

    const status = normalizeStatus(task.status);
    const videoUrl = extractVideoUrl(task);

    return {
      id: task.id,
      model: task.model,
      status,
      progress: task.progress || (status === 'completed' ? 100 : status === 'in_progress' ? 50 : 0),
      video_url: videoUrl,
      error_message: task.error?.message,
      created_at: task.created_at,
      completed_at: task.completed_at,
    };
  }
}
