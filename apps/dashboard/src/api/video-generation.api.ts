/**
 * AI 视频生成 API - 多平台支持
 */

import { getPlatform, type UnifiedVideoParams, type UnifiedTask } from './platforms';
import type { ImageUploadResponse } from '../types/video-generation.types';

export async function createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask> {
  try {
    const platform = getPlatform(params.platform);
    console.log(`[VideoAPI] Using platform: ${platform.name}`);
    return await platform.createVideoGeneration(params);
  } catch (error) {
    console.error('[VideoAPI] Create video error:', error);
    throw error;
  }
}

export async function getTaskStatus(platformId: string, taskId: string): Promise<UnifiedTask> {
  try {
    const platform = getPlatform(platformId);
    return await platform.getTaskStatus(taskId);
  } catch (error) {
    console.error('[VideoAPI] Get task status error:', error);
    throw error;
  }
}

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
        if (Date.now() - startTime > timeout) {
          reject(new Error('Task timeout'));
          return;
        }

        const task = await getTaskStatus(platformId, taskId);
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

export async function uploadImage(file: File): Promise<ImageUploadResponse> {
  const base64 = await fileToBase64(file);

  const response = await fetch('/api/upload-video-frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, base64, size: file.size }),
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  return response.json();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export { getPlatform, getAllPlatforms, getPlatformIds } from './platforms';
export type { UnifiedVideoParams, UnifiedTask, VideoPlatform, PlatformModel } from './platforms';
