import { describe, it, expect } from 'vitest';
import { autopilotNavGroups } from '../../../../apps/dashboard/src/config/navigation.config';

describe('navigation.config — 侧边栏3分组结构 [BEHAVIOR]', () => {
  it('autopilotNavGroups 导出恰好 3 个分组', () => {
    // Red: 当前只有 1 个空标题分组
    expect(autopilotNavGroups).toHaveLength(3);
  });

  it('分组标题依次为 核心功能 / 账号绑定 / 系统', () => {
    const titles = autopilotNavGroups.map(g => g.title);
    expect(titles).toEqual(['核心功能', '账号绑定', '系统']);
  });

  it('/settings 在"系统"分组中', () => {
    const systemGroup = autopilotNavGroups.find(g => g.title === '系统');
    expect(systemGroup).toBeDefined();
    expect(systemGroup!.items.some(i => i.path === '/settings')).toBe(true);
  });

  it('/license 不在任何分组的 items 中（已移出主导航）', () => {
    const allPaths = autopilotNavGroups.flatMap(g => g.items.map(i => i.path));
    expect(allPaths).not.toContain('/license');
  });

  it('/admin/license 和 /admin/users 不在任何分组的 items 中', () => {
    const allPaths = autopilotNavGroups.flatMap(g => g.items.map(i => i.path));
    expect(allPaths).not.toContain('/admin/license');
    expect(allPaths).not.toContain('/admin/users');
  });
});
