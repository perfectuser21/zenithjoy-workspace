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
  Target,
  KeyRound,
  Send,
  Scissors,
  Building2,
  MessageCircle,
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
  // Line04 每客服独立配置 — 每客服设置区
  'PerCsConfigPage': () => import('../pages/PerCsConfigPage'),
  // Sprint 06081603 — 模块健康看板（客户机器 × Line 状态矩阵）
  'ModuleHealthPage': () => import('../pages/ModuleHealthPage'),
  // Line 07 — AI 爆款视频翻拍
  'VideoRemakePipelinePage': () => import('../pages/VideoRemakePipelinePage'),
  // 2026-06-23 — 业务区总览页（短侧栏下钻：区 → 总览卡片 → 子页）
  'AreaHubPage': () => import('../pages/AreaHubPage'),
  // 2026-06-23 — 微信客服一键配置（选机器→填人设/白名单/开关→设置完毕，machine_id 自动）
  'CsOneClickSetupPage': () => import('../pages/CsOneClickSetupPage'),
  // S3 — 客服工作汇总（每客服机今天/昨天 接收/回复/接待/时长 4 个数 + 真发/演练标）
  'CsWorkStatsPage': () => import('../pages/CsWorkStatsPage'),
  // S4 — 客服日报（回看任意历史日期每客服 4 个数 + 小结）
  'CsDailyReportPage': () => import('../pages/CsDailyReportPage'),
  'CustomerListPage': () => import('../pages/CustomerListPage'),
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

// ============ 导航配置：短侧栏 + 区总览下钻（2026-06-23 老板拍板）============
//   客户不暴露"Line"概念，侧栏只放"区"（人话名、无 emoji）；点进区先到总览页
//   （AreaHubPage 卡片入口）再下钻进子页。Line 00 运营中枢 + Line 10 客户管理 =
//   「管理后台」(super-admin)，客户看不到。各子页路由收进 additionalRoutes（仍可达）。
export const autopilotNavGroups: NavGroup[] = [
  {
    title: '',
    items: [
      { path: '/', icon: LayoutDashboard, label: '工作台', featureKey: 'workbench', component: 'Dashboard' },
      { path: '/area/publish', icon: Send, label: '智能发布', featureKey: 'ws1-publish', component: 'AreaHubPage' },
      { path: '/area/acquisition', icon: Target, label: '智能获客', featureKey: 'acquisition-leads', component: 'AreaHubPage' },
      { path: '/area/wechat', icon: MessageCircle, label: '私域客服', featureKey: 'wechat-cs-config', component: 'AreaHubPage' },
      { path: '/area/video', icon: Scissors, label: '视频剪辑', featureKey: 'local-video-pipeline', component: 'AreaHubPage' },
      { path: '/area/remake', icon: Video, label: '爆款翻拍', featureKey: 'video-remake-pipeline', component: 'AreaHubPage' },
      { path: '/area/settings', icon: KeyRound, label: '设置', featureKey: 'license', component: 'AreaHubPage' },
    ]
  },

  // ─── 管理后台（Line 00 运营中枢 + Line 10 客户管理，仅 super-admin）─
  {
    title: '管理',
    items: [
      { path: '/area/admin', icon: Building2, label: '管理后台', featureKey: 'customers-admin', requireSuperAdmin: true, component: 'AreaHubPage' },
    ]
  },
];

// ============ 额外路由配置（不在菜单显示） ============

export const additionalRoutes: RouteConfig[] = [
  // === 区下钻子页（2026-06-23 侧栏改短后，子页从菜单移到这里，仍可被总览页卡片导航到）===
  { path: '/dashboard/publish', component: 'PublishPage', requireAuth: true },
  { path: '/dashboard/platforms/douyin', component: 'DouyinBindPage', requireAuth: true },
  { path: '/dashboard/folder', component: 'FolderBindPage', requireAuth: true },
  { path: '/works', component: 'WorksListPage', requireAuth: true },
  { path: '/platform-data', component: 'PlatformDataPage', requireAuth: true },
  { path: '/content-factory', component: 'ContentFactoryPage', requireAuth: true },
  { path: '/ai-video', component: 'AiVideoGenerationPage', requireAuth: true },
  { path: '/dashboard/leads', component: 'LeadsPage', requireAuth: true },
  { path: '/competitor-research', component: 'CompetitorResearchPage', requireAuth: true },
  { path: '/dashboard/douyin-burner-bind', component: 'DouyinBurnerBindPage', requireAuth: true },
  { path: '/dashboard/feishu-bind', component: 'FeishuBindTenant', requireAuth: true },
  { path: '/wechat/cs-config', component: 'WechatCustomerServiceConfigPage', requireAuth: true },
  { path: '/wechat/setup', component: 'CsOneClickSetupPage', requireAuth: true },
  { path: '/wechat/cs-stats', component: 'CsWorkStatsPage', requireAuth: true },
  { path: '/wechat/cs-daily-report', component: 'CsDailyReportPage', requireAuth: true },
  // requireAuth:false：SPA 路由直接渲染（与 /wechat/per-cs-config 同款），真正的鉴权在后端
  // tenantContext —— 未登录时 GET /api/crm/customers 返 401，页面提示「登录已失效」。
  { path: '/customers', component: 'CustomerListPage', requireAuth: false },
  { path: '/local-video', component: 'LocalVideoPipelinePage', requireAuth: true },
  { path: '/clips', component: 'ContentClipperPage', requireAuth: true },
  { path: '/video-remake', component: 'VideoRemakePipelinePage', requireAuth: true },
  { path: '/dashboard/agent', component: 'AgentDownloadPage', requireAuth: true },
  { path: '/license', component: 'LicensePage', requireAuth: true },
  { path: '/admin/customers', component: 'AdminCustomersPage', requireAuth: true, requireSuperAdmin: true },
  { path: '/operator', component: 'OperatorPage', requireAuth: true, requireSuperAdmin: true },
  { path: '/module-health', component: 'ModuleHealthPage', requireAuth: true },
  { path: '/admin/license', component: 'AdminLicensePage', requireAuth: true, requireSuperAdmin: true },

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

  // === Line04 每客服设置区（纯前端表单，page.route 拦后端验证；E2E 在 windows job 跑）===
  { path: '/wechat/per-cs-config', component: 'PerCsConfigPage', requireAuth: false },

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
