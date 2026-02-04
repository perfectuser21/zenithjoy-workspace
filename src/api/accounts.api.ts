import { apiClient } from './client';

// Types
export interface Account {
  id: string;
  platform: 'xiaohongshu' | 'douyin' | 'bilibili' | 'weibo';
  accountId: string;
  displayName: string;
  avatar?: string;
  isActive: boolean;
  loginStatus: 'valid' | 'expired' | 'unknown';
  lastHealthCheck?: {
    loggedIn: boolean;
    reason?: string;
    checkedAt: string;
  };
  cookies?: any;
  createdAt: string;
  updatedAt: string;
}

export interface AccountMetrics {
  accountId: string;
  platform: string;
  displayName: string;
  followers: {
    total: number;
    delta: number;
    trend: Array<{ date: string; count: number }>;
  };
  engagement: {
    total: number;
    averageRate: number;
    trend: Array<{ date: string; count: number }>;
  };
  impressions: {
    total: number;
    trend: Array<{ date: string; count: number }>;
  };
  content: {
    totalPosts: number;
    topPerformingPosts: Array<{
      id: string;
      title: string;
      url: string;
      engagement: number;
      impressions: number;
      publishedAt: string;
    }>;
  };
}

export interface LoginSession {
  sessionId: string;
  platform: string;
  accountId: string;
  qrCode?: string;
  status: 'pending' | 'scanned' | 'success' | 'failed' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface HealthCheckResult {
  loggedIn: boolean;
  reason?: string;
  checkedAt: string;
}

// API functions
export const accountsApi = {
  // List all accounts
  getAccounts: async (platform?: string) => {
    const response = await apiClient.get<Account[]>('/v1/accounts', {
      params: { platform }
    });
    return response.data;
  },

  // Get account by ID
  getAccount: async (id: string) => {
    const response = await apiClient.get<Account>(`/v1/accounts/${id}`);
    return response.data;
  },

  // Add new account
  addAccount: async (data: {
    platform: string;
    accountId: string;
    displayName: string;
  }) => {
    const response = await apiClient.post<Account>('/v1/accounts', data);
    return response.data;
  },

  // Update account
  updateAccount: async (id: string, data: Partial<Account>) => {
    const response = await apiClient.put<Account>(`/v1/accounts/${id}`, data);
    return response.data;
  },

  // Delete account
  deleteAccount: async (id: string) => {
    await apiClient.delete(`/v1/accounts/${id}`);
  },

  // Health check
  healthCheck: async (id: string) => {
    const response = await apiClient.post<HealthCheckResult>(
      `/v1/accounts/${id}/healthcheck`
    );
    return response.data;
  },

  // Batch health check
  batchHealthCheck: async () => {
    const response = await apiClient.post<{ results: Record<string, HealthCheckResult> }>(
      '/v1/accounts/healthcheck/batch'
    );
    return response.data.results;
  },

  // Initiate login
  initiateLogin: async (platform: string, accountId: string) => {
    const response = await apiClient.post<LoginSession>('/v1/login/initiate', {
      platform,
      accountId
    });
    return response.data;
  },

  // Get login status
  getLoginStatus: async (sessionId: string) => {
    const response = await apiClient.get<LoginSession>(
      `/v1/login/status/${sessionId}`
    );
    return response.data;
  },

  // Refresh QR code
  refreshQRCode: async (sessionId: string) => {
    const response = await apiClient.post<LoginSession>(
      `/v1/login/refresh/${sessionId}`
    );
    return response.data;
  },

  // Get account metrics
  getAccountMetrics: async (id: string, startDate?: string, endDate?: string) => {
    const response = await apiClient.get<AccountMetrics>(
      `/v1/accounts/${id}/metrics`,
      { params: { startDate, endDate } }
    );
    return response.data;
  },

  // Export account data
  exportAccountData: async (id: string, format: 'csv' | 'json' = 'csv') => {
    const response = await apiClient.get(`/v1/accounts/${id}/export`, {
      params: { format },
      responseType: 'blob'
    });
    return response.data;
  },
};
