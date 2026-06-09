/**
 * module-health-access.spec.ts — mac_web Playwright E2E（commit-1 红锚点）
 *
 * 验证普通账号可访问 /module-health 页面，无需超管权限。
 * Red 证据：navigation.config.ts 当前 requireSuperAdmin: true → 普通账号被拒绝访问。
 *
 * 运行环境：mac_web（本机 Playwright，localhost:5174）
 * target_environment: mac_web
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174';

test.describe('/module-health 普通账号可访问 [BEHAVIOR]', () => {
  test('普通账号登录后访问 /module-health 不被 403/重定向拒绝', async ({ page }) => {
    // 直接访问 module-health 页面，验证页面标题或主要内容可见
    // Red 阶段：requireSuperAdmin: true 导致普通账号被重定向或拒绝
    await page.goto(`${BASE_URL}/module-health`);

    // 页面不应重定向到 / 或 /login（普通账号被踢走的标志）
    // 且应含 '模块健康' 相关内容
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/^http:\/\/localhost:5174\/$/, { timeout: 3000 });

    // 应包含 module-health 页面的关键文本
    await expect(page.locator('body')).toContainText(/模块健康|module.health|ModuleHealth/i);
  });

  test('navigation.config.ts /module-health 无 requireSuperAdmin: true', async () => {
    // 静态文件检测（不依赖浏览器，直接读 TS 文件）
    // Red 阶段：文件含 requireSuperAdmin: true → 此 assertion 失败
    const configPath = path.resolve(__dirname, '../../src/config/navigation.config.ts');
    const src = fs.readFileSync(configPath, 'utf8');

    const mhIndex = src.indexOf("path: '/module-health'");
    expect(mhIndex, '未找到 /module-health 路径').toBeGreaterThan(-1);

    const segment = src.slice(mhIndex, mhIndex + 250);
    expect(
      segment,
      '/module-health nav 项仍含 requireSuperAdmin: true，需删除此字段开放普通账号访问'
    ).not.toContain('requireSuperAdmin: true');
  });
});
