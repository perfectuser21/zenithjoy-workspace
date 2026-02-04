import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { NavGroup } from '../config/navigation.config';

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

// Core 动态配置类型
export interface CoreDynamicConfig {
  instanceConfig: InstanceConfig;
  navGroups: NavGroup[];
  pageComponents: Record<string, () => Promise<{ default: any }>>;
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
    // 'settings' 已迁移到 Core
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

// 缓存 Core 配置
let cachedCoreConfig: CoreDynamicConfig | null = null;

// 异步加载 Core 配置
// 注意: 在 CI 或没有 zenithjoy-core 的环境会失败，这是预期的
export async function loadCoreConfig(): Promise<CoreDynamicConfig | null> {
  if (cachedCoreConfig) return cachedCoreConfig;

  try {
    const { buildCoreConfig } = await import('@features/core');
    cachedCoreConfig = await buildCoreConfig();
    return cachedCoreConfig;
  } catch (error) {
    console.warn('Core features not available:', error);
    return null;
  }
}

// 检测是否为 Core 实例
function isCoreInstance(): boolean {
  const hostname = window.location.hostname;
  const port = window.location.port;
  return hostname.startsWith('core.') || hostname.includes('core') || port === '5212';
}

interface InstanceContextType {
  config: InstanceConfig | null;
  loading: boolean;
  error: string | null;
  isFeatureEnabled: (featureKey: string) => boolean;
  isCore: boolean;
  coreConfig: CoreDynamicConfig | null;
}

const InstanceContext = createContext<InstanceContextType | undefined>(undefined);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const [coreConfig, setCoreConfig] = useState<CoreDynamicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initializeConfig() {
      const isCore = isCoreInstance();

      if (isCore) {
        // Core: 动态加载配置
        try {
          const dynamicConfig = await loadCoreConfig();
          setCoreConfig(dynamicConfig);
          setConfig(dynamicConfig.instanceConfig);
          applyTheme(dynamicConfig.instanceConfig.theme, dynamicConfig.instanceConfig.instance);
          document.title = 'Core - 个人工具';
        } catch (err) {
          console.error('Failed to load Core config:', err);
          setError('Failed to load Core configuration');
        }
      } else {
        // Autopilot: 使用静态配置
        setConfig(autopilotConfig);
        applyTheme(autopilotConfig.theme, autopilotConfig.instance);
        document.title = '悦升云端 - Autopilot';
      }

      setLoading(false);
    }

    initializeConfig();
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
    document.body.classList.remove('instance-autopilot', 'instance-core');
    document.body.classList.add(`instance-${instance}`);

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
    // Core 实例: 所有 feature 默认启用（由 manifest 控制）
    if (config.instance === 'core') return true;
    // Autopilot: 使用 features 配置
    return config.features?.[featureKey] === true;
  };

  // 是否为 Core 实例
  const isCore = config?.instance === 'core';

  return (
    <InstanceContext.Provider value={{ config, loading, error, isFeatureEnabled, isCore, coreConfig }}>
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
