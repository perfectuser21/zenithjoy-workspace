/**
 * 平台抽象基类
 */

export interface UnifiedVideoParams {
  platform: string;
  model: string;
  prompt: string;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  resolution?: '720p' | '1080p' | '4k';
  imageUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface UnifiedTask {
  id: string;
  platform: string;
  model: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  created_at?: number;
  completed_at?: number;
  videoUrl?: string;
  error?: { code?: string; message?: string; };
}

export interface PlatformModel {
  id: string;
  name: string;
  description: string;
  capabilities: {
    fixedDuration?: number;
    durationRange?: [number, number];
    aspectRatios: string[];
    resolutions?: string[];
    supportImages: boolean;
    maxImages?: number;
  };
}

export abstract class VideoPlatform {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly models: PlatformModel[];

  abstract createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask>;
  abstract getTaskStatus(taskId: string): Promise<UnifiedTask>;

  getModel(modelId: string): PlatformModel | undefined {
    return this.models.find(m => m.id === modelId);
  }

  validateParams(params: UnifiedVideoParams): { valid: boolean; error?: string } {
    const model = this.getModel(params.model);
    if (!model) {
      return { valid: false, error: `Model ${params.model} not found` };
    }

    if (model.capabilities.fixedDuration && params.duration !== model.capabilities.fixedDuration) {
      return { valid: false, error: `Duration must be ${model.capabilities.fixedDuration} seconds for this model` };
    }

    if (params.aspectRatio && !model.capabilities.aspectRatios.includes(params.aspectRatio)) {
      return { valid: false, error: `Aspect ratio ${params.aspectRatio} not supported` };
    }

    if (params.imageUrls) {
      if (!model.capabilities.supportImages) {
        return { valid: false, error: 'This model does not support images' };
      }
      if (model.capabilities.maxImages && params.imageUrls.length > model.capabilities.maxImages) {
        return { valid: false, error: `Maximum ${model.capabilities.maxImages} images allowed` };
      }
    }

    return { valid: true };
  }
}
