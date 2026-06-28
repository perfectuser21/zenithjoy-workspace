/**
 * 单元覆盖：navigation.config — 短侧栏 + 区下钻（2026-06-23 重构）
 *   + 私域客服「以号为中心」IA 重设计刀2（2026-06-28）：/area/wechat 入口改 CsAreaEntryPage 分诊，
 *     新增 客服号总览 /wechat/accounts + 单号工作台 /wechat/account/:machineId（5 Tab 容器）。
 *
 * 侧栏只放"区"入口（人话名、不暴露 Line、无 emoji）→ 区总览/分诊 → 下钻子页。
 */
import { describe, it, expect } from 'vitest';
import {
  autopilotNavGroups,
  autopilotPageComponents,
  additionalRoutes,
} from '../navigation.config';
import { AREA_HUBS } from '../../pages/AreaHubPage';

const navItems = () => autopilotNavGroups.flatMap((g) => g.items);
const navPaths = () => navItems().map((i) => i.path);
const routePaths = () => additionalRoutes.map((r) => r.path);

describe('config/navigation — 短侧栏 + 区下钻', () => {
  it('侧栏"区"入口指向区组件（多数 AreaHubPage；私域客服 = CsAreaEntryPage 分诊），标签不暴露 Line', () => {
    const areaItems = navItems().filter((i) => i.path.startsWith('/area/'));
    expect(areaItems.length).toBeGreaterThanOrEqual(6);
    for (const it of areaItems) {
      if (it.path === '/area/wechat') {
        // 私域客服改「以号为中心」：入口落分诊页（超管/多号→总览，运营单号→工作台）
        expect(it.component).toBe('CsAreaEntryPage');
      } else {
        expect(it.component).toBe('AreaHubPage');
      }
      expect(it.label).not.toMatch(/line/i);
    }
  });

  it('客户区齐全：智能发布/智能获客/私域客服/视频剪辑/爆款翻拍/设置', () => {
    const paths = navPaths();
    for (const p of [
      '/area/publish',
      '/area/acquisition',
      '/area/wechat',
      '/area/video',
      '/area/remake',
      '/area/settings',
    ]) {
      expect(paths).toContain(p);
    }
  });

  it('管理后台 /area/admin 仅 super-admin 可见', () => {
    const admin = navItems().find((i) => i.path === '/area/admin');
    expect(admin).toBeDefined();
    expect(admin?.requireSuperAdmin).toBe(true);
  });

  it('AreaHubPage 已注册懒加载组件', () => {
    expect(typeof autopilotPageComponents['AreaHubPage']).toBe('function');
  });

  it('子页收进 additionalRoutes（下钻可达）：话术知识库 / License / 客户管理', () => {
    const paths = routePaths();
    expect(paths).toContain('/wechat/cs-config');
    expect(paths).toContain('/license');
    expect(paths).toContain('/admin/customers');
  });

  it('孤儿页 /wechat/per-cs-config 路由已删（整合：每客服设置并进工作台）', () => {
    const paths = routePaths();
    expect(paths).not.toContain('/wechat/per-cs-config');
  });

  it('旧扁平菜单项不再直接挂侧栏（子页/旧聚合页都不在侧栏）', () => {
    const paths = navPaths();
    expect(paths).not.toContain('/dashboard/publish');
    expect(paths).not.toContain('/wechat/cs-config');
    expect(paths).not.toContain('/ai-employees');
    expect(paths).not.toContain('/media');
  });
});

describe('config/navigation — License 入口仍可达（防误删）', () => {
  it('/license 与 /admin/license 都在 additionalRoutes', () => {
    const paths = routePaths();
    expect(paths).toContain('/license');
    expect(paths).toContain('/admin/license');
    const adminLic = additionalRoutes.find((r) => r.path === '/admin/license');
    expect(adminLic?.requireSuperAdmin).toBe(true);
  });

  it('autopilotPageComponents 注册 LicensePage 与 AdminLicensePage', () => {
    expect(typeof autopilotPageComponents['LicensePage']).toBe('function');
    expect(typeof autopilotPageComponents['AdminLicensePage']).toBe('function');
  });
});

describe('AreaHubPage — 区配置（每区总览卡片下钻）', () => {
  it('每个仍用 hub 的客户区都有至少一张下钻卡片（私域客服已改分诊，不在此列）', () => {
    for (const key of ['publish', 'acquisition', 'video', 'remake', 'settings']) {
      expect(AREA_HUBS[key]?.cards.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
});

// 私域客服「以号为中心」IA 重设计刀2（2026-06-28）
describe('config/navigation — 私域客服以号为中心工作台（IA 重设计刀2）', () => {
  it('/area/wechat 入口改 CsAreaEntryPage（分诊），旧 5 卡 wechat hub 已删', () => {
    const wechat = navItems().find((i) => i.path === '/area/wechat');
    expect(wechat?.component).toBe('CsAreaEntryPage');
    expect(AREA_HUBS['wechat']).toBeUndefined();
  });

  it('客服号总览 /wechat/accounts + 单号工作台 /wechat/account/:machineId 在 additionalRoutes', () => {
    const overview = additionalRoutes.find((r) => r.path === '/wechat/accounts');
    expect(overview?.component).toBe('CsAccountOverviewPage');
    const workbench = additionalRoutes.find((r) => r.path === '/wechat/account/:machineId');
    expect(workbench?.component).toBe('CsAccountWorkbenchPage');
  });

  it('总览/工作台/分诊三页组件已注册懒加载', () => {
    expect(typeof autopilotPageComponents['CsAreaEntryPage']).toBe('function');
    expect(typeof autopilotPageComponents['CsAccountOverviewPage']).toBe('function');
    expect(typeof autopilotPageComponents['CsAccountWorkbenchPage']).toBe('function');
  });

  it('旧 5 平级页路由仍保留（深链/老书签不死链）：cs-config / setup / cs-stats / crm', () => {
    const paths = routePaths();
    expect(paths).toContain('/wechat/cs-config');
    expect(paths).toContain('/wechat/setup');
    expect(paths).toContain('/wechat/cs-stats');
    expect(paths).toContain('/wechat/crm');
    // 这些子页组件正是工作台 Tab 复用的页面，懒加载注册仍在
    expect(typeof autopilotPageComponents['WechatCustomerServiceConfigPage']).toBe('function');
    expect(typeof autopilotPageComponents['CsOneClickSetupPage']).toBe('function');
    expect(typeof autopilotPageComponents['CsWorkStatsPage']).toBe('function');
    expect(typeof autopilotPageComponents['CustomerListPage']).toBe('function');
  });
});

// Line04 CRM 重做（2026-06-25）：层级路由仍在（工作台「客户」Tab 复用 CustomerListPage）
describe('config/navigation — CRM 客户好友表路由仍在（工作台客户 Tab 复用）', () => {
  it('层1 列表 /wechat/crm + 层2 状态画像 /wechat/crm/:contactKey 都在 additionalRoutes', () => {
    const paths = routePaths();
    expect(paths).toContain('/wechat/crm');
    expect(paths).toContain('/wechat/crm/:contactKey');
    const list = additionalRoutes.find((r) => r.path === '/wechat/crm');
    expect(list?.component).toBe('CustomerListPage');
    const profile = additionalRoutes.find((r) => r.path === '/wechat/crm/:contactKey');
    expect(profile?.component).toBe('CustomerProfilePage');
  });

  it('旧顶层 /customers 重定向到 /wechat/crm（不再游离顶层菜单）', () => {
    const legacy = additionalRoutes.find((r) => r.path === '/customers');
    expect(legacy?.redirect).toBe('/wechat/crm');
    expect(legacy?.component).toBeUndefined();
  });

  it('层2/层3 页组件 CustomerProfilePage 已注册懒加载', () => {
    expect(typeof autopilotPageComponents['CustomerProfilePage']).toBe('function');
  });
});

// 整合：孤儿页路由 + lazy 映射全删（防回潮）
describe('config/navigation — 孤儿页已删', () => {
  it('PerCsConfigPage / CrmConfigPage / AgentMachines / CsDailyReportPage 的 lazy 映射都已删', () => {
    expect(autopilotPageComponents['PerCsConfigPage']).toBeUndefined();
    expect(autopilotPageComponents['CrmConfigPage']).toBeUndefined();
    expect(autopilotPageComponents['AgentMachines']).toBeUndefined();
    expect(autopilotPageComponents['CsDailyReportPage']).toBeUndefined();
  });

  it('客服日报旧路由 /wechat/cs-daily-report 重定向到工作汇总', () => {
    const legacy = additionalRoutes.find((r) => r.path === '/wechat/cs-daily-report');
    expect(legacy?.redirect).toBe('/wechat/cs-stats');
    expect(legacy?.component).toBeUndefined();
  });
});
