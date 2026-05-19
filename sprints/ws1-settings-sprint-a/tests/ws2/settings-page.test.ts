import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPagePath = path.resolve(__dirname, '../../../../apps/dashboard/src/pages/SettingsPage.tsx');

describe('SettingsPage — 统一设置入口 [BEHAVIOR]', () => {
  it('SettingsPage.tsx 文件存在', () => {
    // Red: 文件未创建时 readFileSync 抛出 ENOENT
    expect(() => readFileSync(settingsPagePath, 'utf8')).not.toThrow();
  });

  it('SettingsPage 导出 default 函数组件', async () => {
    // Red: 文件不存在时 import 报错
    const mod = await import('../../../../apps/dashboard/src/pages/SettingsPage');
    expect(typeof mod.default).toBe('function');
  });

  it('SettingsPage 包含指向 /license 的 Link', () => {
    const src = readFileSync(settingsPagePath, 'utf8');
    expect(src).toContain('to="/license"');
  });

  it('SettingsPage 含 isSuperAdmin 条件渲染管理员专区', () => {
    const src = readFileSync(settingsPagePath, 'utf8');
    expect(src).toContain('isSuperAdmin');
  });
});
