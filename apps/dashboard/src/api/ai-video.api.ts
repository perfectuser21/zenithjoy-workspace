import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export interface AiVideoGeneration {
  id: string;
  platform: string;
  model: string;
  prompt: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  video_url?: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  updated_at: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}

export interface CreateAiVideoParams {
  id: string;
  platform: string;
  model: string;
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}

export interface UpdateAiVideoParams {
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  video_url?: string;
  error_message?: string;
  completed_at?: string;
}

export interface GetHistoryParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface HistoryResponse {
  data: AiVideoGeneration[];
  total: number;
}

export const aiVideoApi = {
  // Get all video generations with optional filters
  async getHistory(params?: GetHistoryParams): Promise<HistoryResponse> {
    const response = await axios.get(`${API_BASE_URL}/ai-video/history`, {
      params,
    });
    return response.data;
  },

  // Get active (in-progress/queued) generations
  async getActiveGenerations(): Promise<AiVideoGeneration[]> {
    const response = await axios.get(`${API_BASE_URL}/ai-video/active`);
    return response.data;
  },

  // Get specific video generation by ID
  async getGenerationById(id: string): Promise<AiVideoGeneration> {
    const response = await axios.get(`${API_BASE_URL}/ai-video/task/${id}`);
    return response.data;
  },

  // Create new video generation
  async createGeneration(params: CreateAiVideoParams): Promise<AiVideoGeneration> {
    const response = await axios.post(`${API_BASE_URL}/ai-video/generate`, params);
    return response.data;
  },

  // Update video generation status
  async updateGeneration(id: string, params: UpdateAiVideoParams): Promise<AiVideoGeneration> {
    const response = await axios.put(`${API_BASE_URL}/ai-video/task/${id}`, params);
    return response.data;
  },

  // Delete video generation
  async deleteGeneration(id: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/ai-video/task/${id}`);
  },
};
