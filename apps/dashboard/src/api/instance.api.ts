import { apiClient } from './client';
import type { InstanceConfig } from '../contexts/InstanceContext';

interface InstanceConfigResponse {
  success: boolean;
  config?: InstanceConfig;
  matched_domain?: string;
  error?: string;
}

export const instanceApi = {
  /**
   * 获取当前实例配置
   * @returns InstanceConfigResponse
   */
  getConfig: async (): Promise<InstanceConfigResponse> => {
    const response = await apiClient.get<InstanceConfigResponse>('/v1/instance-config');
    return response.data;
  },
};
