import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';

// 主题配置
interface ThemeConfig {
  logo: string;
  logoCollapsed?: string;
  favicon?: string;
  primaryColor: string;
  secondaryColor?: string;
  sidebarGradient?: string;
}

// Instance 配置类型
export interface InstanceConfig {
  instance: string;
  name: string;
  theme: ThemeConfig;
  features?: Record<string, boolean>;
}

// Autopilot 配置（蓝色主题）- 团队运营
const autopilotConfig: InstanceConfig = {
  instance: 'autopilot',
  name: '悦升云端',
  theme: {
    logo: '/logo-white.png',
    logoCollapsed: 'Z',
    primaryColor: '#3467D6',
    sidebarGradient: 'linear-gradient(180deg, #1e3a8a 0%, #1e2a5e 100%)',
  },
  features: {
    // 主导航
    'workbench': true,
    'media-scenario': true,  // 新媒体运营场景
    'ai-employees': true,    // AI 员工
    'accounts': true,        // 账号管理
    'works-management': true, // 作品管理 (Database View)
    'works-gallery': true,   // 作品库 (Gallery View)
    'platform-data': true,   // 平台数据展示
    // 旧 features（保留用于兼容，实际已合并到 media-scenario）
    'execution-status': true,
    'tasks': true,
    'data-center': true,
    'content': true,
    'platform-status': true,
    'publish-stats': true,
    'scraping': true,
    'tools': true,
    'canvas': true,
  },
};

interface InstanceContextType {
  config: InstanceConfig | null;
  loading: boolean;
  error: string | null;
  isFeatureEnabled: (featureKey: string) => boolean;
}

const InstanceContext = createContext<InstanceContextType | undefined>(undefined);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Always Autopilot mode
    setConfig(autopilotConfig);
    applyTheme(autopilotConfig.theme, autopilotConfig.instance);
    document.title = '悦升云端';
    setLoading(false);
  }, []);

  // 应用主题到 CSS 变量
  const applyTheme = (theme: ThemeConfig, instance: string) => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', theme.primaryColor);
    root.style.setProperty('--sidebar-gradient', theme.sidebarGradient || 'linear-gradient(180deg, #1e3a8a 0%, #1e2a5e 100%)');

    // 计算派生颜色
    const primaryHex = theme.primaryColor;
    root.style.setProperty('--primary-color-light', `${primaryHex}20`);
    root.style.setProperty('--primary-color-medium', `${primaryHex}40`);
    root.style.setProperty('--primary-color-dark', adjustColor(primaryHex, -20));

    // 为 body 添加实例类名，用于 CSS 区分
    document.body.classList.add('instance-autopilot');

    // 更新 favicon
    if (theme.favicon) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link) {
        link.href = theme.favicon;
      }
    }
  };

  // 检查 feature 是否启用
  const isFeatureEnabled = (featureKey: string): boolean => {
    if (!config) return false;
    return config.features?.[featureKey] === true;
  };

  return (
    <InstanceContext.Provider value={{ config, loading, error, isFeatureEnabled }}>
      {children}
    </InstanceContext.Provider>
  );
}

export function useInstance() {
  const context = useContext(InstanceContext);
  if (context === undefined) {
    throw new Error('useInstance must be used within an InstanceProvider');
  }
  return context;
}

// 辅助函数：调整颜色亮度
function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}
