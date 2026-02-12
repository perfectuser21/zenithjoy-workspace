/**
 * 平台注册中心
 *
 * 管理所有可用的视频生成平台
 */

import type { VideoPlatform } from './base';
import { ToAPIPlatform } from './toapi';

// 注册所有平台
const platforms: Record<string, VideoPlatform> = {
  toapi: new ToAPIPlatform(),
  // 未来可以添加更多平台：
  // replicate: new ReplicatePlatform(),
  // runwayml: new RunwayMLPlatform(),
};

/**
 * 获取指定平台实例
 */
export function getPlatform(platformId: string): VideoPlatform {
  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} not found. Available platforms: ${Object.keys(platforms).join(', ')}`);
  }
  return platform;
}

/**
 * 获取所有可用平台列表
 */
export function getAllPlatforms(): VideoPlatform[] {
  return Object.values(platforms);
}

/**
 * 获取所有平台 ID
 */
export function getPlatformIds(): string[] {
  return Object.keys(platforms);
}

// 导出类型
export type { VideoPlatform, UnifiedVideoParams, UnifiedTask, PlatformModel } from './base';
