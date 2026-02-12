/**
 * AI 视频生成 API - 多平台支持
 *
 * 通过平台抽象层支持多个视频生成平台
 */

import { getPlatform, type UnifiedVideoParams, type UnifiedTask } from './platforms';
import type { ImageUploadResponse } from '../types/video-generation.types';

/**
 * 创建视频生成任务（多平台）
 *
 * @param params 统一的视频生成参数
 * @returns 统一的任务响应
 */
export async function createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask> {
  try {
    // 获取对应平台实例
    const platform = getPlatform(params.platform);

    console.log(`[VideoAPI] Using platform: ${platform.name}`);

    // 调用平台的创建方法
    const task = await platform.createVideoGeneration(params);

    return task;
  } catch (error) {
    console.error('[VideoAPI] Create video error:', error);
    throw error;
  }
}

/**
 * 查询任务状态（多平台）
 *
 * @param platformId 平台 ID
 * @param taskId 任务 ID
 * @returns 统一的任务响应
 */
export async function getTaskStatus(platformId: string, taskId: string): Promise<UnifiedTask> {
  try {
    // 获取对应平台实例
    const platform = getPlatform(platformId);

    // 调用平台的查询方法
    const task = await platform.getTaskStatus(taskId);

    return task;
  } catch (error) {
    console.error('[VideoAPI] Get task status error:', error);
    throw error;
  }
}

/**
 * 轮询任务状态直到完成或失败
 *
 * @param platformId 平台 ID
 * @param taskId 任务 ID
 * @param onProgress 进度回调
 * @param interval 轮询间隔（毫秒）
 * @param timeout 超时时间（毫秒）
 * @returns 最终任务状态
 */
export async function pollTaskStatus(
  platformId: string,
  taskId: string,
  onProgress: (task: UnifiedTask) => void,
  interval: number = 3000,
  timeout: number = 300000
): Promise<UnifiedTask> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        // 检查超时
        if (Date.now() - startTime > timeout) {
          reject(new Error('Task timeout'));
          return;
        }

        // 查询状态
        const task = await getTaskStatus(platformId, taskId);

        // 触发进度回调
        onProgress(task);

        // 检查是否完成
        if (task.status === 'completed') {
          resolve(task);
          return;
        }

        // 检查是否失败
        if (task.status === 'failed') {
          reject(new Error(task.error?.message || 'Task failed'));
          return;
        }

        // 继续轮询
        setTimeout(poll, interval);
      } catch (error) {
        reject(error);
      }
    };

    // 开始轮询
    poll();
  });
}

/**
 * 上传图片到 VPS 服务器
 *
 * @param file 图片文件
 * @returns 上传后的图片 URL
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

// 导出平台相关的类型和函数
export { getPlatform, getAllPlatforms, getPlatformIds } from './platforms';
export type { UnifiedVideoParams, UnifiedTask, VideoPlatform, PlatformModel } from './platforms';
