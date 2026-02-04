import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_KEY = import.meta.env.VITE_COLLECTOR_API_KEY || '';

const contentsClient = axios.create({
  baseURL: `${API_BASE_URL}/contents`,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  }
});

export interface WebsiteContent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  body: string | null;
  content_type: 'article' | 'video' | 'post';
  lang: 'zh' | 'en';
  tags: string[];
  reading_time: string | null;
  faq: { question: string; answer: string }[];
  key_takeaways: string[];
  quotable_insights: string[];
  video_url: string | null;
  thumbnail_url: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateContentInput {
  slug: string;
  title: string;
  description?: string;
  body?: string;
  content_type: 'article' | 'video' | 'post';
  lang?: 'zh' | 'en';
  tags?: string[];
  reading_time?: string;
  faq?: { question: string; answer: string }[];
  key_takeaways?: string[];
  quotable_insights?: string[];
  video_url?: string;
  thumbnail_url?: string;
  status?: 'draft' | 'published';
}

export const contentsApi = {
  // Get all contents (admin)
  getAll: async (options: {
    lang?: string;
    type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ data: WebsiteContent[]; total: number }> => {
    const params = new URLSearchParams();
    if (options.lang) params.append('lang', options.lang);
    if (options.type) params.append('type', options.type);
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const response = await contentsClient.get(`/admin?${params}`);
    return response.data;
  },

  // Get single content by ID
  getById: async (id: string): Promise<WebsiteContent> => {
    const response = await contentsClient.get(`/admin/${id}`);
    return response.data.data;
  },

  // Create new content
  create: async (data: CreateContentInput): Promise<WebsiteContent> => {
    const response = await contentsClient.post('/admin', data);
    return response.data.data;
  },

  // Update content
  update: async (id: string, data: Partial<CreateContentInput>): Promise<WebsiteContent> => {
    const response = await contentsClient.put(`/admin/${id}`, data);
    return response.data.data;
  },

  // Delete content
  delete: async (id: string): Promise<void> => {
    await contentsClient.delete(`/admin/${id}`);
  },

  // Publish content
  publish: async (id: string): Promise<WebsiteContent> => {
    const response = await contentsClient.post(`/admin/${id}/publish`);
    return response.data.data;
  },

  // Unpublish content
  unpublish: async (id: string): Promise<WebsiteContent> => {
    const response = await contentsClient.post(`/admin/${id}/unpublish`);
    return response.data.data;
  },
};

export default contentsApi;
