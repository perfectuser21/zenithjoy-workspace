/**
 * 平台注册和管理
 */

import { VideoPlatform } from './base';
import { ToAPIPlatform } from './toapi';

const platforms: Map<string, VideoPlatform> = new Map();

const toapi = new ToAPIPlatform();
platforms.set(toapi.id, toapi);

export function getPlatform(platformId: string): VideoPlatform {
  const platform = platforms.get(platformId);
  if (!platform) {
    throw new Error(`Platform ${platformId} not found`);
  }
  return platform;
}

export function getAllPlatforms(): VideoPlatform[] {
  return Array.from(platforms.values());
}

export function getPlatformIds(): string[] {
  return Array.from(platforms.keys());
}

export type { UnifiedVideoParams, UnifiedTask, VideoPlatform, PlatformModel } from './base';
