/**
 * 单元覆盖：navigation.config — 短侧栏 + 区下钻（2026-06-23 重构）
 *
 * 侧栏只放"区"入口（人话名、不暴露 Line、无 emoji）→ AreaHubPage 总览页 → 卡片下钻子页。
 * 子页路由收进 additionalRoutes（仍可达）。License / 每客服设置 等不再直接挂侧栏。
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
  it('侧栏"区"入口都指向 AreaHubPage，且标签不暴露 Line', () => {
    const areaItems = navItems().filter((i) => i.path.startsWith('/area/'));
    expect(areaItems.length).toBeGreaterThanOrEqual(6);
    for (const it of areaItems) {
      expect(it.component).toBe('AreaHubPage');
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

  it('子页收进 additionalRoutes（下钻可达）：每客服设置 / 微信客服配置 / License / 客户管理', () => {
    const paths = routePaths();
    expect(paths).toContain('/wechat/per-cs-config');
    expect(paths).toContain('/wechat/cs-config');
    expect(paths).toContain('/license');
    expect(paths).toContain('/admin/customers');
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
  it('私域客服区主卡是「我的客服机」(/wechat/setup)，且不再有重复的「每客服设置」卡（整合成一个客服中心）', () => {
    const wechat = AREA_HUBS['wechat'];
    expect(wechat).toBeDefined();
    // 整合后：客服机一处看健康+配置 = /wechat/setup 是主入口
    expect(wechat.cards.some((c) => c.to === '/wechat/setup')).toBe(true);
    // 删掉重复的「每客服设置」卡（功能并进「我的客服机」），前台不再暴露
    expect(wechat.cards.some((c) => c.to === '/wechat/per-cs-config')).toBe(false);
  });

  it('每个客户区都有至少一张下钻卡片', () => {
    for (const key of ['publish', 'acquisition', 'wechat', 'video', 'remake', 'settings']) {
      expect(AREA_HUBS[key]?.cards.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
});

// Line04 CRM 重做（2026-06-25）：客户好友表入口归进「私域客服」板块，三层下钻 + 旧顶层 /customers 重定向
describe('config/navigation — CRM 客户好友表入口（修正1 入口移进私域客服板块）', () => {
  it('私域客服区有「客户好友表」卡，下钻 /wechat/crm', () => {
    const wechat = AREA_HUBS['wechat'];
    const crmCard = wechat.cards.find((c) => c.to === '/wechat/crm');
    expect(crmCard).toBeDefined();
    expect(crmCard?.label).toContain('客户好友表');
  });

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
