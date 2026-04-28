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
