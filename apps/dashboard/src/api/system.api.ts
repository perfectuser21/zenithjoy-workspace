import { apiClient } from './client';

// Types
export interface ServiceHealth {
  status: 'healthy' | 'unhealthy';
  latency_ms: number | null;
  last_check: string | null;
  error: string | null;
}

// Health check history record for a single check
export interface HealthCheckRecord {
  timestamp: string;
  status: 'healthy' | 'unhealthy';
  latency_ms: number | null;
  error: string | null;
}

// Extended service health with history (used by frontend)
export interface ServiceHealthWithHistory extends ServiceHealth {
  history?: HealthCheckRecord[];
}

export interface SystemHealthResponse {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  services: Record<string, ServiceHealth>;
  degraded: boolean;
  degraded_reason: string | null;
  timestamp: string;
}

export interface DiskIO {
  readSpeed: number;   // bytes per second
  writeSpeed: number;  // bytes per second
}

export interface NetworkIO {
  uploadSpeed: number;   // bytes per second
  downloadSpeed: number; // bytes per second
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  memoryUsed: number;
  avgResponseTime: number;
  errorRate: number;
  activeConnections: number;
  uptime: number;
  diskIO?: DiskIO;
  networkIO?: NetworkIO;
}

export interface MetricHistory {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  responseTime: number;
}

export interface SystemMetricsResponse {
  current: SystemMetrics;
  history: MetricHistory[];
}

// API functions
export const systemApi = {
  // Get system metrics (CPU, memory, response time, etc.)
  getMetrics: async (): Promise<SystemMetricsResponse> => {
    const response = await apiClient.get<SystemMetricsResponse>('/v1/system/metrics');
    return response.data;
  },

  // Get system health (multi-service aggregated)
  getHealth: async (): Promise<SystemHealthResponse> => {
    const response = await apiClient.get<SystemHealthResponse>('/system/health');
    return response.data;
  },
};
