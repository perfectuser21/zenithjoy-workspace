import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_KEY = import.meta.env.VITE_COLLECTOR_API_KEY || '';

/**
 * 从 cookie 或 localStorage 读取当前飞书 user 的 open_id。
 * Sprint B 多租户隔离：所有 API 请求自动注入 X-Feishu-User-Id 头。
 *
 * 优先级：user.feishu_user_id > user.id（兼容字段）。
 * 解析失败 / 无 user → 返回空串。
 */
export function getFeishuUserIdFromStorage(): string {
  // Cookie 优先（飞书登录后由 AuthContext 写入）
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(^|; )user=([^;]+)/);
    if (m) {
      try {
        const u = JSON.parse(decodeURIComponent(m[2]));
        return (u && (u.feishu_user_id || u.id)) || '';
      } catch {
        /* fall through to localStorage */
      }
    }
  }
  // localStorage fallback（迁移期）
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      const ls = localStorage.getItem('user');
      if (ls) {
        try {
          const u = JSON.parse(ls);
          return (u && (u.feishu_user_id || u.id)) || '';
        } catch {
          return '';
        }
      }
    }
  } catch {
    /* ignore localStorage access errors */
  }
  return '';
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  }
});

// Sprint B 多租户：自动注入 X-Feishu-User-Id 头
apiClient.interceptors.request.use((config) => {
  const id = getFeishuUserIdFromStorage();
  if (id) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)['X-Feishu-User-Id'] = id;
  }
  return config;
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
