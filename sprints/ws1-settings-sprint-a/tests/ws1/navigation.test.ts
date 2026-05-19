import { describe, it, expect } from 'vitest';
import { autopilotNavGroups, autopilotPageComponents } from '../../../../apps/dashboard/src/config/navigation.config';

describe('侧边栏导航分组重构 [BEHAVIOR]', () => {
  it('autopilotNavGroups 应有 3 个分组', () => {
    expect(autopilotNavGroups).toHaveLength(3);
  });

  it('每个分组都有非空 title', () => {
    for (const group of autopilotNavGroups) {
      expect(group.title).not.toBe('');
      expect(group.title.length).toBeGreaterThan(0);
    }
  });

  it('3 个分组标题分别为 运营核心 / 账号与渠道 / 系统管理', () => {
    const titles = autopilotNavGroups.map(g => g.title);
    expect(titles).toContain('运营核心');
    expect(titles).toContain('账号与渠道');
    expect(titles).toContain('系统管理');
  });

  it('系统管理分组包含 系统设置 NavItem（path=/settings, featureKey=admin-settings）', () => {
    const sysGroup = autopilotNavGroups.find(g => g.title === '系统管理');
    expect(sysGroup).toBeDefined();
    const settingsItem = sysGroup?.items.find(i => i.path === '/settings');
    expect(settingsItem).toBeDefined();
    expect(settingsItem?.featureKey).toBe('admin-settings');
    expect(settingsItem?.requireSuperAdmin).toBeFalsy();
  });

  it('AdminSettingsPage 在 autopilotPageComponents 映射中存在', () => {
    expect(autopilotPageComponents['AdminSettingsPage']).toBeDefined();
    expect(typeof autopilotPageComponents['AdminSettingsPage']).toBe('function');
  });

  it('requireSuperAdmin 条目（license-admin / users-admin）保留在系统管理分组', () => {
    const sysGroup = autopilotNavGroups.find(g => g.title === '系统管理');
    expect(sysGroup).toBeDefined();
    const adminItems = sysGroup?.items.filter(i => i.requireSuperAdmin === true);
    expect(adminItems?.length).toBeGreaterThanOrEqual(2);
  });

  it('运营核心 / 账号与渠道 分组不含 requireSuperAdmin 条目', () => {
    const nonAdminGroups = autopilotNavGroups.filter(
      g => g.title === '运营核心' || g.title === '账号与渠道'
    );
    for (const group of nonAdminGroups) {
      const adminItems = group.items.filter(i => i.requireSuperAdmin === true);
      expect(adminItems).toHaveLength(0);
    }
  });
});
