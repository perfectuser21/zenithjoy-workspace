import { apiClient } from './client';

// Types
export interface SystemSettings {
  notifications: {
    feishu: {
      enabled: boolean;
      webhookUrl: string;
      notifyOnSuccess: boolean;
      notifyOnFailure: boolean;
      notifyOnLogin: boolean;
      notifyOnMetrics: boolean;
    };
  };
  notion: {
    enabled: boolean;
    apiKey: string;
    databaseId: string;
  };
  collection: {
    timeout: number;
    retries: number;
    concurrency: number;
    schedules: {
      dailyMetrics: string; // Cron expression
      healthCheck: string;
    };
  };
  alerts: {
    loginExpiry: {
      enabled: boolean;
      daysBeforeExpiry: number;
    };
    followerDrop: {
      enabled: boolean;
      threshold: number; // percentage
    };
    engagementDrop: {
      enabled: boolean;
      threshold: number;
    };
  };
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  category: 'login' | 'collection' | 'workflow' | 'system';
  title: string;
  message: string;
  data?: any;
  isRead: boolean;
  createdAt: string;
}

// API functions
export const settingsApi = {
  // Get system settings
  getSettings: async () => {
    const response = await apiClient.get<SystemSettings>('/v1/settings');
    return response.data;
  },

  // Update system settings
  updateSettings: async (settings: Partial<SystemSettings>) => {
    const response = await apiClient.put<SystemSettings>('/v1/settings', settings);
    return response.data;
  },

  // Test Feishu webhook
  testFeishuWebhook: async (webhookUrl: string) => {
    const response = await apiClient.post<{ success: boolean; error?: string }>(
      '/v1/settings/test/feishu',
      { webhookUrl }
    );
    return response.data;
  },

  // Test Notion connection
  testNotionConnection: async (apiKey: string, databaseId: string) => {
    const response = await apiClient.post<{ success: boolean; error?: string }>(
      '/v1/settings/test/notion',
      { apiKey, databaseId }
    );
    return response.data;
  },

  // Get notifications
  getNotifications: async (unreadOnly = false, limit = 50) => {
    const response = await apiClient.get<Notification[]>('/v1/notifications', {
      params: { unreadOnly, limit }
    });
    return response.data;
  },

  // Mark notification as read
  markNotificationRead: async (id: string) => {
    await apiClient.patch(`/v1/notifications/${id}/read`);
  },

  // Mark all notifications as read
  markAllNotificationsRead: async () => {
    await apiClient.post('/v1/notifications/read-all');
  },

  // Delete notification
  deleteNotification: async (id: string) => {
    await apiClient.delete(`/v1/notifications/${id}`);
  },

  // Get unread count
  getUnreadCount: async () => {
    const response = await apiClient.get<{ count: number }>('/v1/notifications/unread-count');
    return response.data.count;
  },

  // Get system health (multi-service aggregated)
  getSystemHealth: async () => {
    const response = await apiClient.get<{
      success: boolean;
      status: 'healthy' | 'degraded' | 'unhealthy';
      service: string;
      services: {
        [key: string]: {
          status: 'healthy' | 'unhealthy';
          latency_ms: number | null;
          last_check: string | null;
          error: string | null;
        };
      };
      degraded: boolean;
      degraded_reason: string | null;
      timestamp: string;
    }>('/system/health');
    return response.data;
  },
};
