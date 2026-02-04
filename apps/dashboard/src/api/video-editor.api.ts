import { apiClient } from './client';

// 类型定义
export interface UploadedVideo {
  id: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface TrimOptions {
  start: string;
  end: string;
}

export interface ResizeOptions {
  width: number;
  height: number;
  fit: 'cover' | 'contain' | 'fill';
}

export type AspectRatioPreset = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';

export interface SubtitleOptions {
  text: string;
  style: 'bottom' | 'top' | 'center';
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
}

export interface ProcessOptions {
  trim?: TrimOptions;
  resize?: ResizeOptions;
  preset?: AspectRatioPreset;
  subtitle?: SubtitleOptions;
}

// Whisper 转录片段
export interface TranscriptSegment {
  id: number;
  start: number;       // 开始时间（秒）
  end: number;         // 结束时间（秒）
  text: string;        // 转录文字
  confidence?: number; // 置信度 0-1
  isSilence?: boolean; // 是否是静音段
}

// AI 剪辑操作
export interface AiEditOperation {
  id: string;
  type: 'trim' | 'remove_silence' | 'resize' | 'add_subtitle' | 'speed_change' | 'merge';
  description: string;
  params: Record<string, any>;
  timeRange?: { start: number; end: number };
  estimatedSaving?: number; // 预计节省的时间（秒）
}

// AI 分析结果
export interface AiAnalysisResult {
  summary: string;       // AI 对需求的理解说明
  transcript?: string;   // Whisper 转录的文字（完整）
  transcriptSegments?: TranscriptSegment[]; // Whisper 转录片段（含时间戳）
  params: ProcessOptions; // AI 生成的处理参数
  operations?: AiEditOperation[]; // AI 建议的剪辑操作列表
  estimatedDuration?: number; // 处理后预计时长（秒）
  silenceRanges?: { start: number; end: number }[]; // 检测到的静音段
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

// 多步骤处理状态
export type ProcessingStep = 'whisper' | 'ai_analysis' | 'ffmpeg_prepare' | 'ffmpeg_execute';

export interface StepInfo {
  step: ProcessingStep;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
}

export const PROCESSING_STEPS: { step: ProcessingStep; name: string; icon: string }[] = [
  { step: 'whisper', name: '语音识别', icon: '🎤' },
  { step: 'ai_analysis', name: 'AI 分析', icon: '🤖' },
  { step: 'ffmpeg_prepare', name: '准备处理', icon: '⚙️' },
  { step: 'ffmpeg_execute', name: '视频处理', icon: '🎬' },
];

export interface VideoJob {
  id: string;
  status: JobStatus;
  progress: number;
  outputPath?: string;
  error?: string;
  options: ProcessOptions;
  originalVideo: UploadedVideo;
  userPrompt?: string;
  aiAnalysis?: string;
  transcript?: string;
  steps?: StepInfo[];
  currentStep?: ProcessingStep;
  createdAt: string;
  updatedAt: string;
}

// 预设尺寸信息
export const PRESET_INFO: Record<AspectRatioPreset, { name: string; width: number; height: number; platforms: string[] }> = {
  '9:16': { name: '竖屏', width: 1080, height: 1920, platforms: ['抖音', 'TikTok', '快手'] },
  '16:9': { name: '横屏', width: 1920, height: 1080, platforms: ['YouTube', 'B站'] },
  '1:1': { name: '方形', width: 1080, height: 1080, platforms: ['Instagram', '微博'] },
  '4:3': { name: '传统', width: 1440, height: 1080, platforms: ['传统视频'] },
  '3:4': { name: '竖屏4:3', width: 1080, height: 1440, platforms: ['小红书'] },
};

// API 函数
export const videoEditorApi = {
  // 上传视频（支持进度回调）
  uploadVideo: async (
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<UploadedVideo> => {
    const formData = new FormData();
    formData.append('video', file);

    const response = await apiClient.post<{ success: boolean; video: UploadedVideo }>(
      '/v1/video-editor/upload',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 600000, // 10分钟超时，大文件需要
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percent);
          }
        },
      }
    );
    return response.data.video;
  },

  // 获取所有视频
  getVideos: async (): Promise<UploadedVideo[]> => {
    const response = await apiClient.get<UploadedVideo[]>('/v1/video-editor/videos');
    return response.data;
  },

  // 获取视频信息
  getVideo: async (id: string): Promise<UploadedVideo> => {
    const response = await apiClient.get<UploadedVideo>(`/v1/video-editor/videos/${id}`);
    return response.data;
  },

  // 删除视频
  deleteVideo: async (id: string): Promise<void> => {
    await apiClient.delete(`/v1/video-editor/videos/${id}`);
  },

  // 创建处理任务
  processVideo: async (videoId: string, options: ProcessOptions): Promise<VideoJob> => {
    const response = await apiClient.post<{ success: boolean; job: VideoJob }>(
      '/v1/video-editor/process',
      { videoId, options }
    );
    return response.data.job;
  },

  // 获取所有任务
  getJobs: async (): Promise<VideoJob[]> => {
    const response = await apiClient.get<VideoJob[]>('/v1/video-editor/jobs');
    return response.data;
  },

  // 获取任务状态
  getJobStatus: async (jobId: string): Promise<VideoJob> => {
    const response = await apiClient.get<VideoJob>(`/v1/video-editor/jobs/${jobId}`);
    return response.data;
  },

  // 删除任务
  deleteJob: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/v1/video-editor/jobs/${jobId}`);
  },

  // 获取下载 URL
  getDownloadUrl: (jobId: string): string => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
    return `${baseUrl}/v1/video-editor/download/${jobId}`;
  },

  // 获取预览 URL
  getPreviewUrl: (filePath: string): string => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
    return `${baseUrl}/v1/video-editor/preview/${filePath}`;
  },

  // AI 分析（只分析，不处理，返回分析结果供用户确认）
  aiAnalyze: async (videoId: string, userPrompt: string): Promise<AiAnalysisResult> => {
    const response = await apiClient.post<{ success: boolean; analysis: AiAnalysisResult }>(
      '/v1/video-editor/ai-analyze',
      { videoId, userPrompt }
    );
    return response.data.analysis;
  },

  // AI 智能处理（触发 Headless Claude）
  aiProcess: async (videoId: string, userPrompt: string): Promise<{ id: string; status: string; message: string }> => {
    const response = await apiClient.post<{ success: boolean; job: { id: string; status: string; message: string } }>(
      '/v1/video-editor/ai-process',
      { videoId, userPrompt }
    );
    return response.data.job;
  },
};
