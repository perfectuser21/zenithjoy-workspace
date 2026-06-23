/**
 * 单元覆盖：navigation.config 导航配置中关键 License 路由
 *
 * 防止后续修改时误删 /license 或 /admin/license 入口。
 */
import { describe, it, expect } from 'vitest';
import {
  autopilotNavGroups,
  autopilotPageComponents,
} from '../navigation.config';

describe('config/navigation', () => {
  it('autopilotNavGroups 含 /license 入口（所有登录用户）', () => {
    const all = autopilotNavGroups.flatMap((g) => g.items);
    const license = all.find((i) => i.path === '/license');
    expect(license).toBeDefined();
    expect(license?.requireSuperAdmin).not.toBe(true);
  });

  it('autopilotNavGroups 含 /admin/license 入口（requireSuperAdmin: true）', () => {
    const all = autopilotNavGroups.flatMap((g) => g.items);
    const adminLic = all.find((i) => i.path === '/admin/license');
    expect(adminLic).toBeDefined();
    expect(adminLic?.requireSuperAdmin).toBe(true);
  });

  it('autopilotPageComponents 注册 LicensePage 与 AdminLicensePage', () => {
    expect(typeof autopilotPageComponents['LicensePage']).toBe('function');
    expect(typeof autopilotPageComponents['AdminLicensePage']).toBe('function');
  });
});

describe('config/navigation — 按 Line 组织（2026-06-23 重构）', () => {
  const groupByTitle = (t: string) => autopilotNavGroups.find((g) => g.title === t);

  it('客户侧栏按 Line 分组：Line 01/02/04/05/07 都在', () => {
    for (const t of [
      'Line 01 · 智能发布',
      'Line 02 · 智能获客',
      'Line 04 · 私域 AI 接管',
      'Line 05 · 视频剪辑',
      'Line 07 · AI 爆款翻拍',
    ]) {
      expect(groupByTitle(t)).toBeDefined();
    }
  });

  it('每客服设置（/wechat/per-cs-config）已进 Line 04 侧栏（之前隐藏、侧栏看不到）', () => {
    const line04 = groupByTitle('Line 04 · 私域 AI 接管');
    const paths = line04?.items.map((i) => i.path) ?? [];
    expect(paths).toContain('/wechat/cs-config');
    expect(paths).toContain('/wechat/per-cs-config');
  });

  it('全局只有一个「设置」分组（账号级：下载 Agent + License）', () => {
    const settings = autopilotNavGroups.filter((g) => g.title === '⚙️ 设置');
    expect(settings).toHaveLength(1);
    const paths = settings[0].items.map((i) => i.path);
    expect(paths).toContain('/dashboard/agent');
    expect(paths).toContain('/license');
  });

  it('Line 00/10 收进「管理后台」super-admin，不出现在客户 Line 分组', () => {
    const admin = groupByTitle('管理后台');
    expect(admin).toBeDefined();
    expect(admin?.items.find((i) => i.path === '/admin/customers')?.requireSuperAdmin).toBe(true);
    expect(admin?.items.find((i) => i.path === '/operator')?.requireSuperAdmin).toBe(true);
  });

  it('旧聚合页（AI 员工 /ai-employees、新媒体运营 /media）已从侧栏移除', () => {
    const all = autopilotNavGroups.flatMap((g) => g.items).map((i) => i.path);
    expect(all).not.toContain('/ai-employees');
    expect(all).not.toContain('/media');
  });
});

describe('config/navigation — 会员管理并入客户管理（#816 结构性去重）', () => {
  it('删除独立的「会员管理」菜单（/admin/users 不再出现在导航）', () => {
    const all = autopilotNavGroups.flatMap((g) => g.items);
    expect(all.find((i) => i.path === '/admin/users')).toBeUndefined();
  });

  it('只保留一个「客户管理」入口（/admin/customers，requireSuperAdmin）', () => {
    const all = autopilotNavGroups.flatMap((g) => g.items);
    const customers = all.filter((i) => i.path === '/admin/customers');
    expect(customers).toHaveLength(1);
    expect(customers[0].requireSuperAdmin).toBe(true);
    expect(customers[0].label).toBe('客户管理');
  });
});
