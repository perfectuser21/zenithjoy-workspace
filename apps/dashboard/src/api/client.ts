import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_KEY = import.meta.env.VITE_COLLECTOR_API_KEY || '';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  }
});

// Account types
export interface Account {
  platform: string;
  accountId: string;
  displayName: string;
  isActive?: boolean;
  lastHealthCheck?: {
    loggedIn: boolean;
    reason?: string;
    checkedAt?: string;
  };
}

export interface HealthCheckResult {
  loggedIn: boolean;
  reason?: string;
}

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

export interface DailyReport {
  date: string;
  total_accounts: number;
  total_followers_delta: number;
  total_impressions: number;
  total_engagements: number;
  by_platform: Record<string, any>;
}

// API functions
export const api = {
  // Accounts
  getAccounts: () =>
    apiClient.get<Account[]>('/v1/accounts'),

  addAccount: (account: Omit<Account, 'isActive' | 'lastHealthCheck'>) =>
    apiClient.post('/v1/accounts', account),

  // Health check
  healthCheck: (platform: string, accountId: string) =>
    apiClient.post<HealthCheckResult>('/v1/healthcheck', { platform, accountId }),

  // Collection
  collectDaily: (platform: string, accountId: string, date: string) =>
    apiClient.post<MetricsData>('/v1/collect_daily', { platform, accountId, date }),

  // Metrics
  getMetrics: (platform?: string, accountId?: string, startDate?: string, endDate?: string) =>
    apiClient.get<MetricsData[]>('/v1/metrics', { params: { platform, accountId, startDate, endDate } }),

  // Reports
  getDailyReport: (date: string) =>
    apiClient.get<DailyReport>(`/v1/reports/daily/${date}`),

  // Login
  initiateLogin: (platform: string, accountId: string) =>
    apiClient.post('/v1/login/initiate', { platform, accountId }),

  getLoginStatus: (sessionId: string) =>
    apiClient.get(`/v1/login/status/${sessionId}`),

  // Manual trigger
  triggerWorkflow: () =>
    apiClient.post('/v1/trigger/workflow'),
};
