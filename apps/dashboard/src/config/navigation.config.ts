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
  Briefcase,
  MessageCircle,
  Wrench,
} from 'lucide-react';

// ============ 类型定义 ============

export interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  featureKey: string;
  // 权限控制
  requireSuperAdmin?: boolean;
  requireStaff?: boolean;
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
  requireStaff?: boolean;
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
  // Line02 Path2 Step3 — 安卓客户端自助装机绑定（下载页 + 深链二维码）
  'AndroidDownloadPage': () => import('../pages/AndroidDownloadPage'),
  // Path 2 Sprint A — 飞书集成
  'FeishuBindTenant': () => import('../pages/FeishuBindTenant'),
  // zj2 Smart Acquisition — 获客 Leads
  'LeadsPage': () => import('../pages/LeadsPage'),
  // Path 2 Sprint B-1 — 评论抓取（绑号功能已并入 AcquisitionAccountsPage）
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
  // Path 4 Sprint B — 微信客服中台配置（话术知识库）
  'WechatCustomerServiceConfigPage': () => import('../pages/WechatCustomerServiceConfigPage'),
  // Sprint 06081603 — 模块健康看板（客户机器 × Line 状态矩阵）
  'ModuleHealthPage': () => import('../pages/ModuleHealthPage'),
  // Sprint 06260400 — 机器管理（机器列表 + 抖音号 + 主/副 + 添加号）
  'MachineManagementPage': () => import('../pages/MachineManagementPage'),
  // Line02 刀1 — 智能获客「分析+指派」配置（参数表单 + 指派计划 + Cookie 健康）
  'AcquisitionConfigPage': () => import('../pages/AcquisitionConfigPage'),
  // Line02 — 公司信息页（公司画像 + 产品卖点 + 客户画像）
  'CompanyProfilePage': () => import('../pages/CompanyProfilePage'),
  // Line 07 — AI 爆款视频翻拍
  'VideoRemakePipelinePage': () => import('../pages/VideoRemakePipelinePage'),
  // 2026-06-23 — 业务区总览页（短侧栏下钻：区 → 总览卡片 → 子页）
  'AreaHubPage': () => import('../pages/AreaHubPage'),
  // 2026-06-29 — 智能获客 Step-by-Step 向导（替换 AreaHubPage 6 平级磁贴）
  'AcquisitionHubPage': () => import('../pages/AcquisitionHubPage'),
  // Line02 IA 重设计 Track A — Hub 改 4 模块入口，账号管理 / 采集任务两级独立页
  'AcquisitionAccountsPage': () => import('../pages/AcquisitionAccountsPage'),
  'AcquisitionTasksPage': () => import('../pages/AcquisitionTasksPage'),
  // Line02 IA 重做 — 触达记录历史页
  'AcquisitionOutreachPage': () => import('../pages/AcquisitionOutreachPage'),
  // 2026-06-23 — 微信客服一键配置（选机器→填人设/白名单/开关→设置完毕，machine_id 自动）
  'CsOneClickSetupPage': () => import('../pages/CsOneClickSetupPage'),
  // 客服工作汇总（今天/昨天实时 + 历史任意一天日报含小结，已并入旧 S4 客服日报）
  'CsWorkStatsPage': () => import('../pages/CsWorkStatsPage'),
  'CustomerListPage': () => import('../pages/CustomerListPage'),
  // Line04 CRM 重做 — 层2 状态/画像页（内含层3 聊天记录下钻）
  'CustomerProfilePage': () => import('../pages/CustomerProfilePage'),
  // 2026-06-28 — 微信客服「以号为中心」IA 重设计刀2：区入口分诊 + 客服号总览 + 单号工作台（5 Tab）
  'CsAreaEntryPage': () => import('../pages/CsAreaEntryPage'),
  'CsAccountOverviewPage': () => import('../pages/CsAccountOverviewPage'),
  'CsAccountWorkbenchPage': () => import('../pages/CsAccountWorkbenchPage'),
  // Line 00 运营中枢 — 员工工具中心（staff only）
  'SkillEvalPage': () => import('../pages/SkillEvalPage'),
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
      { path: '/area/acquisition', icon: Target, label: '智能获客', featureKey: 'acquisition-leads', component: 'AcquisitionHubPage' },
      // 私域客服改「以号为中心」(IA 重设计刀2)：入口落 CsAreaEntryPage 分诊 → 超管/多号进总览，运营单号直进工作台。
      { path: '/area/wechat', icon: MessageCircle, label: '私域客服', featureKey: 'wechat-cs-config', component: 'CsAreaEntryPage' },
      { path: '/area/video', icon: Scissors, label: '视频剪辑', featureKey: 'local-video-pipeline', component: 'AreaHubPage' },
      { path: '/area/remake', icon: Video, label: '爆款翻拍', featureKey: 'video-remake-pipeline', component: 'AreaHubPage' },
      { path: '/company-profile', icon: Briefcase, label: '公司信息', featureKey: 'acquisition-leads', component: 'CompanyProfilePage' },
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

  // ─── 员工工具（Line 00 运营中枢内部工具，仅 staff 白名单账号可见）─
  {
    title: '员工工具',
    items: [
      { path: '/staff/skill-eval', icon: Wrench, label: 'Skill 评测上传', featureKey: 'staff-skill-eval', requireStaff: true, component: 'SkillEvalPage' },
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
  // Line02 IA 重设计 Track A — 账号管理 / 采集任务两级视图
  { path: '/area/acquisition/accounts', component: 'AcquisitionAccountsPage', requireAuth: true },
  { path: '/area/acquisition/tasks', component: 'AcquisitionTasksPage', requireAuth: true },
  { path: '/area/acquisition/tasks/:taskId', component: 'AcquisitionTasksPage', requireAuth: true },
  // Line02 IA 重做 — Leads + Outreach 子页（GP 顺序卡 3/4 的目标路由）
  { path: '/area/acquisition/leads', component: 'LeadsPage', requireAuth: true },
  { path: '/area/acquisition/outreach', component: 'AcquisitionOutreachPage', requireAuth: true },
  { path: '/dashboard/machines', component: 'MachineManagementPage', requireAuth: true },
  { path: '/dashboard/acquisition-config', component: 'AcquisitionConfigPage', requireAuth: true },
  { path: '/company-profile', component: 'CompanyProfilePage', requireAuth: true },
  { path: '/dashboard/feishu-bind', component: 'FeishuBindTenant', requireAuth: true },
  // 以号为中心 IA 重设计刀2：客服号总览 + 单号工作台（5 Tab 容器）。
  //   /wechat/accounts 总览（超管/多号）；/wechat/account/:machineId 单号工作台。
  { path: '/wechat/accounts', component: 'CsAccountOverviewPage', requireAuth: true },
  { path: '/wechat/account/:machineId', component: 'CsAccountWorkbenchPage', requireAuth: true },
  // 旧 5 个平级页路由保留（深链/老书签不死链）；其内容也作为工作台 Tab 复用承载。
  { path: '/wechat/cs-config', component: 'WechatCustomerServiceConfigPage', requireAuth: true },
  { path: '/wechat/setup', component: 'CsOneClickSetupPage', requireAuth: true },
  { path: '/wechat/cs-stats', component: 'CsWorkStatsPage', requireAuth: true },
  // 客服日报已并进「客服工作汇总」(CsWorkStatsPage 历史日期 Tab)，旧路由重定向兼容老书签
  { path: '/wechat/cs-daily-report', redirect: '/wechat/cs-stats', requireAuth: true },
  // requireAuth:false：SPA 路由直接渲染，真正的鉴权在后端
  // tenantContext / 多通道闸 —— 未登录时 GET /api/crm/customers 返 401，页面提示「登录已失效」。
  // CRM 重做（2026-06-25）：入口归进「私域客服」板块（/area/wechat 卡片下钻），不再游离顶层。
  // 层1 好友表 /wechat/crm；层2 状态/画像页（含层3 聊天记录下钻）/wechat/crm/:contactKey。
  { path: '/wechat/crm', component: 'CustomerListPage', requireAuth: false },
  { path: '/wechat/crm/:contactKey', component: 'CustomerProfilePage', requireAuth: false },
  // 旧顶层 /customers 重定向到板块内入口，兼容老链接/书签
  // requireAuth:false：未登录时也放行（让 <Navigate> 先把 URL 换成 /wechat/crm，鉴权在后端）
  { path: '/customers', redirect: '/wechat/crm', requireAuth: false },
  { path: '/local-video', component: 'LocalVideoPipelinePage', requireAuth: true },
  { path: '/clips', component: 'ContentClipperPage', requireAuth: true },
  { path: '/video-remake', component: 'VideoRemakePipelinePage', requireAuth: true },
  { path: '/dashboard/agent', component: 'AgentDownloadPage', requireAuth: true },
  { path: '/dashboard/android', component: 'AndroidDownloadPage', requireAuth: true },
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

  // === 员工工具（staff only）===
  { path: '/staff/skill-eval', component: 'SkillEvalPage', requireAuth: true, requireStaff: true },

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
  isSuperAdmin: boolean,
  isStaff = false
): NavGroup[] {
  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        // 检查 feature flag（staff-skill-eval 视为恒启用，无需 instanceConfig）
        if (item.featureKey !== 'staff-skill-eval' && !isFeatureEnabled(item.featureKey)) return false;
        // 检查超级管理员权限
        if (item.requireSuperAdmin && !isSuperAdmin) return false;
        // 检查员工权限
        if (item.requireStaff && !isStaff) return false;
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
