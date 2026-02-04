/**
 * 导航配置 - 配置驱动 UI
 *
 * 这个文件定义了菜单和路由的配置
 * 修改这里就能添加/删除/修改页面，无需改动其他代码
 */

import type { ComponentType } from 'react';
import { lazy } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Video,
  Users,
  KeyRound,
  LayoutGrid,
} from 'lucide-react';

// ============ 类型定义 ============

export interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  featureKey: string;
  // 权限控制
  requireSuperAdmin?: boolean;
  // 路由配置
  component?: string;  // 组件路径，用于懒加载
  redirect?: string;   // 重定向目标
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface RouteConfig {
  path: string;
  component?: string;
  redirect?: string;
  requireAuth?: boolean;
  requireSuperAdmin?: boolean;
}

// ============ 页面组件懒加载映射 ============

// Autopilot 本地页面组件
export const autopilotPageComponents: Record<string, () => Promise<{ default: ComponentType }>> = {
  'Dashboard': () => import('../pages/Dashboard'),
  'ContentData': () => import('../pages/ContentData'),
  'ContentPublish': () => import('../pages/ContentPublish'),
  'ExecutionStatus': () => import('../pages/ExecutionStatus'),
  // Tasks moved to zenithjoy-core
  'PublishStats': () => import('../pages/PublishStats'),
  'LoginPage': () => import('../pages/LoginPage'),
  'ScrapingPage': () => import('../pages/ScrapingPage'),
  'MediaScenarioPage': () => import('../pages/MediaScenarioPage'),
  'AiEmployeesPage': () => import('../pages/AiEmployeesPage'),
  'AiEmployeeDetailPage': () => import('../pages/AiEmployeeDetailPage'),
  'AiAbilityDetailPage': () => import('../pages/AiAbilityDetailPage'),
  'AccountsList': () => import('../pages/accounts/AccountsList'),
  // FeatureDashboard and CommandCenter moved to Core features/business
};

// 向后兼容：保留 pageComponents 导出（仅 Autopilot 组件）
// Core 组件现在从 coreConfig.pageComponents 动态加载
export const pageComponents = autopilotPageComponents;

// 获取懒加载组件
export function getPageComponent(name: string) {
  const loader = pageComponents[name];
  if (!loader) {
    console.warn(`Page component not found: ${name}`);
    return null;
  }
  return lazy(loader);
}

// ============ Autopilot 实例导航配置 ============
// Core 导航现在从 InstanceContext.coreConfig.navGroups 动态加载

export const autopilotNavGroups: NavGroup[] = [
  {
    title: '',  // 无分组标题，扁平展示
    items: [
      {
        path: '/',
        icon: LayoutDashboard,
        label: '工作台',
        featureKey: 'workbench',
        component: 'Dashboard'
      },
      {
        path: '/media',
        icon: Video,
        label: '新媒体运营',
        featureKey: 'media-scenario',
        component: 'MediaScenarioPage'
      },
      {
        path: '/ai-employees',
        icon: Users,
        label: 'AI 员工',
        featureKey: 'ai-employees',
        component: 'AiEmployeesPage'
      },
      {
        path: '/accounts',
        icon: KeyRound,
        label: '账号管理',
        featureKey: 'accounts',
        component: 'AccountsList'
      },
      // 管理员设置已迁移到 Core: core.zenjoymedia.media
    ]
  }
];

// ============ 额外路由配置（不在菜单显示） ============

export const additionalRoutes: RouteConfig[] = [
  // === AI 员工详情页路由 ===
  { path: '/ai-employees/:employeeId', component: 'AiEmployeeDetailPage', requireAuth: true },
  { path: '/ai-employees/:employeeId/abilities/:abilityId', component: 'AiAbilityDetailPage', requireAuth: true },

  // === 新媒体运营场景子路由 ===
  // 这些路由由 MediaScenarioPage 内部处理嵌套路由
  { path: '/media/*', component: 'MediaScenarioPage', requireAuth: true },

  // === 旧路由重定向（兼容） ===
  { path: '/content', redirect: '/media/content' },
  { path: '/scraping', redirect: '/media/content/scraping' },
  { path: '/tasks', redirect: '/media/publish' },
  { path: '/tasks/:name', redirect: '/media/publish' },
  { path: '/execution-status', redirect: '/media/publish/history' },
  { path: '/platform-status', redirect: '/media/publish/platforms' },
  { path: '/publish-stats', redirect: '/media/data' },
  { path: '/data-center', redirect: '/media/data/analytics' },
  // 登录相关
  { path: '/login/:platform/:accountId', component: 'LoginPage', requireAuth: true },

  // === Features Dashboard (Core 实例) ===
  { path: '/features', component: 'FeatureDashboard', requireAuth: true },
  { path: '/command', component: 'CommandCenter', requireAuth: true },
  { path: '/command/*', component: 'CommandCenter', requireAuth: true },

  // 管理员子页面已迁移到 Core
  // ClaudeMonitor, VpsMonitor, ClaudeStats, N8n*, Canvas 等
  // 通过 Core 实例访问: core.zenjoymedia.media
];

// ============ 辅助函数 ============

/**
 * 获取 Autopilot 导航配置
 * Core 导航现在通过 InstanceContext.coreConfig.navGroups 获取
 */
export function getAutopilotNavGroups(): NavGroup[] {
  return autopilotNavGroups;
}

/**
 * 过滤菜单项（根据 feature flag 和权限）
 */
export function filterNavGroups(
  groups: NavGroup[],
  isFeatureEnabled: (key: string) => boolean,
  isSuperAdmin: boolean
): NavGroup[] {
  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        // 检查 feature flag
        if (!isFeatureEnabled(item.featureKey)) return false;
        // 检查超级管理员权限
        if (item.requireSuperAdmin && !isSuperAdmin) return false;
        return true;
      })
    }))
    .filter(group => group.items.length > 0);
}

/**
 * 从导航配置中提取所有路由
 */
export function extractRoutesFromNav(groups: NavGroup[]): RouteConfig[] {
  const routes: RouteConfig[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      routes.push({
        path: item.path,
        component: item.component,
        redirect: item.redirect,
        requireAuth: true,
        requireSuperAdmin: item.requireSuperAdmin,
      });
    }
  }

  return routes;
}
