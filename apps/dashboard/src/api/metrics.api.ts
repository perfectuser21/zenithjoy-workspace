import { apiClient } from './client';

// Types
export interface MetricsData {
  platform: string;
  accountId: string;
  date: string;
  followers_total: number;
  followers_delta: number;
  impressions: number;
  engagements: number;
  posts_published: number;
  top_post_url?: string;
  top_post_engagement?: number;
}

export interface DashboardMetrics {
  overview: {
    totalFollowers: number;
    totalFollowersDelta: number;
    totalImpressions: number;
    totalEngagements: number;
    engagementRate: number;
  };
  trends: {
    followers: Array<{ date: string; count: number }>;
    impressions: Array<{ date: string; count: number }>;
    engagements: Array<{ date: string; count: number }>;
  };
  byPlatform: Array<{
    platform: string;
    followers: number;
    followersDelta: number;
    impressions: number;
    engagements: number;
    accounts: number;
  }>;
  topContent: Array<{
    id: string;
    platform: string;
    accountId: string;
    title: string;
    url: string;
    engagement: number;
    impressions: number;
    publishedAt: string;
  }>;
}

export interface DailyReport {
  date: string;
  total_accounts: number;
  total_followers_delta: number;
  total_impressions: number;
  total_engagements: number;
  by_platform: Record<string, {
    accounts: number;
    followers_delta: number;
    impressions: number;
    engagements: number;
  }>;
}

export interface TimeRange {
  start: string;
  end: string;
}

// API functions
export const metricsApi = {
  // Get dashboard metrics
  getDashboardMetrics: async (timeRange: 'today' | 'week' | 'month' = 'week') => {
    const response = await apiClient.get<DashboardMetrics>('/v1/metrics/dashboard', {
      params: { timeRange }
    });
    return response.data;
  },

  // Get metrics for specific account
  getMetrics: async (
    platform?: string,
    accountId?: string,
    startDate?: string,
    endDate?: string
  ) => {
    const response = await apiClient.get<MetricsData[]>('/v1/metrics', {
      params: { platform, accountId, startDate, endDate }
    });
    return response.data;
  },

  // Get daily report
  getDailyReport: async (date: string) => {
    const response = await apiClient.get<DailyReport>(`/v1/reports/daily/${date}`);
    return response.data;
  },

  // Get weekly report
  getWeeklyReport: async (weekStart: string) => {
    const response = await apiClient.get<any>(`/v1/reports/weekly/${weekStart}`);
    return response.data;
  },

  // Get monthly report
  getMonthlyReport: async (month: string) => {
    const response = await apiClient.get<any>(`/v1/reports/monthly/${month}`);
    return response.data;
  },

  // Trigger data collection manually
  triggerCollection: async (platform?: string, accountId?: string) => {
    const response = await apiClient.post('/v1/collect/trigger', {
      platform,
      accountId
    });
    return response.data;
  },

  // Get collection status
  getCollectionStatus: async () => {
    const response = await apiClient.get<{
      status: 'idle' | 'running' | 'error';
      currentTask?: string;
      progress?: number;
      lastRun?: string;
    }>('/v1/collect/status');
    return response.data;
  },
};
