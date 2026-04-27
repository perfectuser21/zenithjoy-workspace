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
  Database,
  Sparkles,
  Factory,
  Target,
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
  'WorksListPage': () => import('../pages/WorksListPage'),
  'WorksGalleryPage': () => import('../pages/WorksGalleryPage'),
  'WorkDetailPage': () => import('../pages/WorkDetailPage'),
  'FieldManagementPage': () => import('../pages/FieldManagementPage'),
  'AiEmployeeDetailPage': () => import('../pages/AiEmployeeDetailPage'),
  'AiAbilityDetailPage': () => import('../pages/AiAbilityDetailPage'),
  'AccountsList': () => import('../pages/accounts/AccountsList'),
  'PlatformDataPage': () => import('../pages/PlatformDataPage'),
  'AiVideoGenerationPage': () => import('../pages/AiVideoGenerationPage'),
  'AiVideoHistoryPage': () => import('../pages/AiVideoHistoryPage'),
  'ContentFactoryPage': () => import('../pages/ContentFactoryPage'),
  'ContentTypeConfigPage': () => import('../pages/ContentTypeConfigPage'),
  'PipelineOutputPage': () => import('../pages/PipelineOutputPage'),
  'CompetitorResearchPage': () => import('../pages/CompetitorResearchPage'),
  // FeatureDashboard and CommandCenter moved to Core features/business
};

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

// ============ 导航配置 ============

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
        path: '/works',
        icon: Database,
        label: '作品管理',
        featureKey: 'works-management',
        component: 'WorksListPage'
      },
      {
        path: '/platform-data',
        icon: Database,
        label: '平台数据',
        featureKey: 'platform-data',
        component: 'PlatformDataPage'
      },
      {
        path: '/ai-video',
        icon: Sparkles,
        label: 'AI 视频',
        featureKey: 'ai-video-generation',
        component: 'AiVideoGenerationPage'
      },
      {
        path: '/content-factory',
        icon: Factory,
        label: '内容工厂',
        featureKey: 'content-factory',
        component: 'ContentFactoryPage'
      },
      {
        path: '/competitor-research',
        icon: Target,
        label: '智能对标',
        featureKey: 'competitor_research',
        component: 'CompetitorResearchPage',
      },
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

  // === 作品相关路由 ===
  { path: '/works/gallery', component: 'WorksGalleryPage', requireAuth: true },
  { path: '/works/fields', component: 'FieldManagementPage', requireAuth: true },
  { path: '/works/:id', component: 'WorkDetailPage', requireAuth: true },

  // === 内容工厂配置路由 ===
  { path: "/content-factory/config", component: "ContentTypeConfigPage", requireAuth: true },
  { path: '/content-factory/:id/output', component: 'PipelineOutputPage', requireAuth: true },

    // === AI 视频相关路由 ===
  { path: '/ai-video/history', component: 'AiVideoHistoryPage', requireAuth: true },

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

];

// ============ 辅助函数 ============

/**
 * 获取导航配置
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
