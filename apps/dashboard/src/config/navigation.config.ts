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
  KeyRound,
  ShieldCheck,
  Download,
  Music2,
  Folder,
  Send,
  Scissors,
  Building2,
  MonitorCheck,
  MessageCircle,
  Activity,
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
  'AgentDebugPage': () => import('../pages/AgentDebugPage'),
  'LicensePage': () => import('../pages/LicensePage'),
  'AdminLicensePage': () => import('../pages/AdminLicensePage'),
  // #816: 会员管理已并入「客户管理」(AdminCustomersPage)，AdminUsersPage 已删
  'AdminCustomersPage': () => import('../pages/AdminCustomersPage'),
  // Walking Skeleton #1 — 客户首次成功路径（抖音版）
  'AgentDownloadPage': () => import('../pages/AgentDownloadPage'),
  'DouyinBindPage': () => import('../pages/DouyinBindPage'),
  // Path 2 Sprint A — 飞书集成
  'FeishuBindTenant': () => import('../pages/FeishuBindTenant'),
  // zj2 Smart Acquisition — 获客 Leads
  'LeadsPage': () => import('../pages/LeadsPage'),
  // Path 2 Sprint B-1 — 抖音小号绑定 + 评论抓取
  'DouyinBurnerBindPage': () => import('../pages/DouyinBurnerBindPage'),
  'FolderBindPage': () => import('../pages/FolderBindPage'),
  'PublishPage': () => import('../pages/PublishPage'),
  'LocalVideoPipelinePage': () => import('../pages/LocalVideoPipelinePage'),
  // Content Clipper
  'ContentClipperPage': () => import('../pages/ContentClipperPage'),
  'ContentClipDetailPage': () => import('../pages/ContentClipDetailPage'),
  // FeatureDashboard and CommandCenter moved to Core features/business
  // Operator Dashboard — Session 状态矩阵（is_operator 权限守卫）
  'OperatorPage': () => import('../pages/OperatorPage'),
  // zj10 Customer Mgmt — 平台绑定状态 + 发布日志
  'AdminPlatformSessionsPage': () => import('../pages/AdminPlatformSessionsPage'),
  'AdminPublishLogsPage': () => import('../pages/AdminPublishLogsPage'),
  // Path 4 Sprint B — 微信客服中台配置
  'WechatCustomerServiceConfigPage': () => import('../pages/WechatCustomerServiceConfigPage'),
  // Sprint 06081603 — 模块健康看板（客户机器 × Line 状态矩阵）
  'ModuleHealthPage': () => import('../pages/ModuleHealthPage'),
  // Line 07 — AI 爆款视频翻拍
  'VideoRemakePipelinePage': () => import('../pages/VideoRemakePipelinePage'),
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
  // ─── 主功能 ───────────────────────────────────────────────────
  {
    title: '',
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
        path: '/local-video',
        icon: Scissors,
        label: '本地视频处理',
        featureKey: 'local-video-pipeline',
        component: 'LocalVideoPipelinePage'
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
      {
        path: '/clips',
        icon: Scissors,
        label: '内容采集',
        featureKey: 'content-clipper',
        component: 'ContentClipperPage',
      },
      {
        path: '/video-remake',
        icon: Video,
        label: 'AI 视频翻拍',
        featureKey: 'video-remake-pipeline',
        component: 'VideoRemakePipelinePage',
      },
      {
        path: '/dashboard/leads',
        icon: Target,
        label: '获客 Leads',
        featureKey: 'acquisition-leads',
        component: 'LeadsPage',
      },
    ]
  },

  // ─── 设置 ─────────────────────────────────────────────────────
  {
    title: '设置',
    items: [
      {
        path: '/dashboard/agent',
        icon: Download,
        label: '下载 Agent',
        featureKey: 'ws1-agent-download',
        component: 'AgentDownloadPage',
      },
      {
        path: '/dashboard/platforms/douyin',
        icon: Music2,
        label: '抖音绑定',
        featureKey: 'ws1-douyin-bind',
        component: 'DouyinBindPage',
      },
      {
        path: '/dashboard/douyin-burner-bind',
        icon: KeyRound,
        label: '绑抖音小号',
        featureKey: 'douyinBurnerBind',
        component: 'DouyinBurnerBindPage',
      },
      {
        path: '/dashboard/folder',
        icon: Folder,
        label: '文件夹绑定',
        featureKey: 'ws1-folder-bind',
        component: 'FolderBindPage',
      },
      {
        path: '/dashboard/feishu-bind',
        icon: KeyRound,
        label: '飞书绑定',
        featureKey: 'feishuBind',
        component: 'FeishuBindTenant',
      },
      {
        path: '/dashboard/publish',
        icon: Send,
        label: '一键发布',
        featureKey: 'ws1-publish',
        component: 'PublishPage',
      },
      {
        path: '/wechat/cs-config',
        icon: MessageCircle,
        label: '微信客服配置',
        featureKey: 'wechat-cs-config',
        component: 'WechatCustomerServiceConfigPage',
      },
      {
        path: '/license',
        icon: KeyRound,
        label: 'License',
        featureKey: 'license',
        component: 'LicensePage',
      },
    ]
  },

  // ─── 管理员（仅 superadmin 可见）────────────────────────────────
  {
    title: '管理员',
    items: [
      {
        path: '/operator',
        icon: MonitorCheck,
        label: 'Session 健康监控',
        featureKey: 'operator-dashboard',
        requireSuperAdmin: true,
        component: 'OperatorPage',
      },
      {
        path: '/module-health',
        icon: Activity,
        label: '模块健康',
        featureKey: 'module-health',
        component: 'ModuleHealthPage',
      },
      {
        path: '/admin/license',
        icon: ShieldCheck,
        label: 'License 管理',
        featureKey: 'license-admin',
        requireSuperAdmin: true,
        component: 'AdminLicensePage',
      },
      {
        // #816: 「会员管理」(/admin/users) 已并入「客户管理」，导航只保留一个客户管理入口
        path: '/admin/customers',
        icon: Building2,
        label: '客户管理',
        featureKey: 'customers-admin',
        requireSuperAdmin: true,
        component: 'AdminCustomersPage',
      },
    ]
  },
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

  // === Better-auth 邮箱+密码登录系列（公开访问，PR-3）===
  // 实际路由组件在 App.tsx 静态注册（SignIn/SignUp/ForgotPassword/FeishuLogin），
  // 这里仅声明 requireAuth=false 让 currentRouteAllowsUnauthenticated 检测能通过
  { path: '/login', requireAuth: false },
  { path: '/signup', requireAuth: false },
  { path: '/forgot-password', requireAuth: false },
  { path: '/login/feishu', requireAuth: false },

  // === Features Dashboard (Core 实例) ===
  { path: '/features', component: 'FeatureDashboard', requireAuth: true },
  { path: '/command', component: 'CommandCenter', requireAuth: true },
  { path: '/command/*', component: 'CommandCenter', requireAuth: true },

  // === Agent 调试页面 ===
  { path: '/agent-debug', component: 'AgentDebugPage', requireAuth: true },

  // === Content Clipper 详情页 ===
  { path: '/clips/:id', component: 'ContentClipDetailPage', requireAuth: true },

  // === 客户管理子页面（super-admin only）===
  { path: '/admin/customers/platform-sessions', component: 'AdminPlatformSessionsPage', requireAuth: true, requireSuperAdmin: true },
  { path: '/admin/customers/publish-logs', component: 'AdminPublishLogsPage', requireAuth: true, requireSuperAdmin: true },

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
