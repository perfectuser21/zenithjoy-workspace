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

describe('config/navigation — 三组结构', () => {
  it('共有 3 个导航分组：主功能 / 设置 / 管理员', () => {
    expect(autopilotNavGroups).toHaveLength(3);
    expect(autopilotNavGroups[0].title).toBe('');
    expect(autopilotNavGroups[1].title).toBe('设置');
    expect(autopilotNavGroups[2].title).toBe('管理员');
  });

  it('设置分组含 下载 Agent 和 飞书绑定', () => {
    const settings = autopilotNavGroups[1];
    const paths = settings.items.map((i) => i.path);
    expect(paths).toContain('/dashboard/agent');
    expect(paths).toContain('/dashboard/feishu-bind');
  });

  it('/operator 在管理员分组且 requireSuperAdmin: true', () => {
    const admin = autopilotNavGroups[2];
    const operator = admin.items.find((i) => i.path === '/operator');
    expect(operator).toBeDefined();
    expect(operator?.requireSuperAdmin).toBe(true);
  });

  it('主功能分组不含设置类页面（文件夹绑定等）', () => {
    const main = autopilotNavGroups[0];
    const paths = main.items.map((i) => i.path);
    expect(paths).not.toContain('/dashboard/folder');
    expect(paths).not.toContain('/dashboard/feishu-bind');
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
