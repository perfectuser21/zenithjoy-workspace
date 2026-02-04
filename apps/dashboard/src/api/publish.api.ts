import { apiClient } from './client';

// Types
export interface PlatformSpec {
  name: string;
  displayName: string;
  imageSpecs: {
    aspectRatios: string[];
    maxWidth: number;
    maxHeight: number;
    maxSize: number;
    formats: string[];
  };
  videoSpecs: {
    maxDuration: number;
    maxSize: number;
    formats: string[];
  };
  titleLimit: number;
  contentLimit: number;
  supportsMultiImage: boolean;
  maxImages: number;
}

export interface UploadedFile {
  id: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export interface PublishTask {
  id: string;
  title: string;
  titleZh?: string;
  titleEn?: string;
  content: string | null;
  contentZh?: string | null;
  contentEn?: string | null;
  mediaType: 'image' | 'video' | 'text';
  originalFiles: string[];
  coverImage?: string | null;
  processedFiles: Record<string, string[]>;
  targetPlatforms: string[];
  status: 'draft' | 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  scheduleAt: string | null;
  results: Record<string, { success: boolean; url?: string; error?: string }>;
  createdAt: string;
  updatedAt: string;
  createdBy?: number | null;
  creatorName?: string | null;
  creatorAvatar?: string | null;
  progress?: {
    total: number;
    completed: number;
    success: number;
    failed: number;
  };
}

// API functions
export const publishApi = {
  // Get all platform specifications
  getPlatforms: async (): Promise<PlatformSpec[]> => {
    const response = await apiClient.get<PlatformSpec[]>('/v1/publish/platforms');
    return response.data;
  },

  // Get specific platform spec
  getPlatform: async (platform: string): Promise<PlatformSpec> => {
    const response = await apiClient.get<PlatformSpec>(`/v1/publish/platforms/${platform}`);
    return response.data;
  },

  // Upload files
  uploadFiles: async (files: File[]): Promise<UploadedFile[]> => {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    const response = await apiClient.post<{ success: boolean; files: UploadedFile[] }>(
      '/v1/publish/upload',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data.files;
  },

  // Get all publish tasks
  getTasks: async (options?: { status?: string; limit?: number; offset?: number }): Promise<PublishTask[]> => {
    const response = await apiClient.get<PublishTask[]>('/v1/publish/tasks', {
      params: options,
    });
    return response.data;
  },

  // Get task by ID
  getTask: async (id: string): Promise<PublishTask> => {
    const response = await apiClient.get<PublishTask>(`/v1/publish/tasks/${id}`);
    return response.data;
  },

  // Create new publish task
  createTask: async (data: {
    titleZh: string;
    titleEn: string;
    contentZh?: string;
    contentEn?: string;
    mediaType: 'image' | 'video' | 'text';
    originalFiles?: string[];
    coverImage?: string;
    targetPlatforms: string[];
    scheduleAt?: string;
  }): Promise<PublishTask> => {
    const response = await apiClient.post<PublishTask>('/v1/publish/tasks', data);
    return response.data;
  },

  // Update task
  updateTask: async (id: string, data: Partial<{
    title: string;
    content: string;
    originalFiles: string[];
    targetPlatforms: string[];
    scheduleAt: string | null;
  }>): Promise<PublishTask> => {
    const response = await apiClient.patch<PublishTask>(`/v1/publish/tasks/${id}`, data);
    return response.data;
  },

  // Delete task
  deleteTask: async (id: string): Promise<void> => {
    await apiClient.delete(`/v1/publish/tasks/${id}`);
  },

  // Submit task for publishing
  submitTask: async (id: string): Promise<PublishTask> => {
    const response = await apiClient.post<PublishTask>(`/v1/publish/tasks/${id}/submit`);
    return response.data;
  },

  // Get file URL (public media endpoint)
  getFileUrl: (filePath: string): string => {
    // Use the public /media/ endpoint that doesn't require auth
    return `/media/${filePath}`;
  },

  // Retry failed platform
  retryPlatform: async (taskId: string, platform: string): Promise<PublishTask> => {
    const response = await apiClient.post<PublishTask>(`/v1/publish/tasks/${taskId}/retry/${platform}`);
    return response.data;
  },

  // Copy task as draft
  copyTask: async (taskId: string): Promise<PublishTask> => {
    const response = await apiClient.post<PublishTask>(`/v1/publish/tasks/${taskId}/copy`);
    return response.data;
  },

  // Get publish statistics
  getStats: async (): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPlatform: Record<string, { total: number; success: number; failed: number }>;
    recentTrend: Array<{ date: string; success: number; failed: number }>;
  }> => {
    const response = await apiClient.get('/v1/publish/stats');
    return response.data;
  },
};

export default publishApi;
