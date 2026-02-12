/**
 * 视频生成平台抽象接口
 *
 * 定义所有视频生成平台必须实现的方法和类型
 */

/**
 * 统一的视频生成参数（前端 UI 使用）
 */
export interface UnifiedVideoParams {
  platform: string;
  model: string;
  prompt: string;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  resolution?: '720p' | '1080p' | '4k';
  imageUrls?: string[];
  metadata?: Record<string, any>;
}

/**
 * 统一的任务响应（前端显示使用）
 */
export interface UnifiedTask {
  id: string;
  platform: string;
  model: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  created_at?: number;
  completed_at?: number;
  videoUrl?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * 模型配置
 */
export interface PlatformModel {
  id: string;
  name: string;
  description: string;
  capabilities: {
    fixedDuration?: number;  // 固定时长（秒）
    durationRange?: [number, number];  // 可选时长范围
    aspectRatios: string[];  // 支持的宽高比
    resolutions?: string[];  // 支持的分辨率
    supportImages: boolean;  // 是否支持图片输入
    maxImages?: number;      // 最多支持几张图片
  };
}

/**
 * 视频生成平台抽象接口
 */
export abstract class VideoPlatform {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly models: PlatformModel[];

  /**
   * 创建视频生成任务
   */
  abstract createVideoGeneration(params: UnifiedVideoParams): Promise<UnifiedTask>;

  /**
   * 查询任务状态
   */
  abstract getTaskStatus(taskId: string): Promise<UnifiedTask>;

  /**
   * 获取指定模型配置
   */
  getModel(modelId: string): PlatformModel | undefined {
    return this.models.find(m => m.id === modelId);
  }

  /**
   * 验证参数是否符合模型要求
   */
  validateParams(params: UnifiedVideoParams): { valid: boolean; error?: string } {
    const model = this.getModel(params.model);
    if (!model) {
      return { valid: false, error: `Model ${params.model} not found` };
    }

    // 验证时长
    if (model.capabilities.fixedDuration) {
      if (params.duration && params.duration !== model.capabilities.fixedDuration) {
        return {
          valid: false,
          error: `Duration must be ${model.capabilities.fixedDuration}s for this model`
        };
      }
    } else if (model.capabilities.durationRange) {
      const [min, max] = model.capabilities.durationRange;
      if (params.duration && (params.duration < min || params.duration > max)) {
        return {
          valid: false,
          error: `Duration must be between ${min}s and ${max}s`
        };
      }
    }

    // 验证宽高比
    if (params.aspectRatio && !model.capabilities.aspectRatios.includes(params.aspectRatio)) {
      return {
        valid: false,
        error: `Aspect ratio ${params.aspectRatio} not supported. Supported: ${model.capabilities.aspectRatios.join(', ')}`
      };
    }

    // 验证图片数量
    if (params.imageUrls) {
      if (!model.capabilities.supportImages) {
        return { valid: false, error: 'This model does not support image input' };
      }
      if (model.capabilities.maxImages && params.imageUrls.length > model.capabilities.maxImages) {
        return {
          valid: false,
          error: `Maximum ${model.capabilities.maxImages} images allowed`
        };
      }
    }

    return { valid: true };
  }
}
