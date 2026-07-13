/**
 * line04-preflight-card.spec.ts — mac_web Playwright E2E（commit-1 红锚点）
 *
 * 验证 WechatCustomerServiceConfigPage 顶部 Line04PreflightCard 组件可见。
 * Red 证据：Line04PreflightCard.tsx 尚未创建 → 组件不存在 → 页面无法渲染。
 *
 * 运行环境：mac_web（本机 Playwright，localhost:5174）
 * target_environment: mac_web
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

// ESM 下 __dirname 不存在,从 import.meta.url 派生;goto 用 playwright baseURL 相对路径统一(巡检 2026-07-12 收编修复)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Line04PreflightCard 组件 [BEHAVIOR]', () => {
  test('Line04PreflightCard.tsx 组件文件存在', async () => {
    // 静态文件存在性检测（Red 阶段：文件不存在 → 测试失败）
    const cardPath = path.resolve(
      __dirname,
      '../src/components/Line04PreflightCard.tsx'
    );
    expect(
      fs.existsSync(cardPath),
      `Line04PreflightCard.tsx 不存在（路径: ${cardPath}）`
    ).toBe(true);
  });

  test('Line04PreflightCard.tsx 含 fetchModuleHealth 调用', async () => {
    const cardPath = path.resolve(
      __dirname,
      '../src/components/Line04PreflightCard.tsx'
    );
    expect(fs.existsSync(cardPath), 'Line04PreflightCard.tsx 不存在').toBe(true);
    const src = fs.readFileSync(cardPath, 'utf8');
    expect(src, '组件缺 fetchModuleHealth 调用').toContain('fetchModuleHealth');
  });

  test('Line04PreflightCard.tsx 含无数据时提示 "Agent 未连接"', async () => {
    const cardPath = path.resolve(
      __dirname,
      '../src/components/Line04PreflightCard.tsx'
    );
    expect(fs.existsSync(cardPath), 'Line04PreflightCard.tsx 不存在').toBe(true);
    const src = fs.readFileSync(cardPath, 'utf8');
    expect(src, '组件缺"Agent 未连接"无数据提示文案').toContain('Agent 未连接');
  });

  test('WechatCustomerServiceConfigPage 已引用 Line04PreflightCard', async () => {
    const pagePath = path.resolve(
      __dirname,
      '../src/pages/WechatCustomerServiceConfigPage.tsx'
    );
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(
      src,
      'WechatCustomerServiceConfigPage.tsx 未引用 Line04PreflightCard'
    ).toContain('Line04PreflightCard');
  });

  test('微信客服配置页顶部 Line04PreflightCard 在浏览器可见', async ({ page }) => {
    // Red 阶段：组件不存在 → 页面报错或无法渲染该区域
    await page.goto('/wechat/cs-config');

    // 页面应在 30s 内加载（不跳转到 login，假设测试环境已 mock 认证）
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Line04PreflightCard 应可见（data-testid 或文本内容标识）
    const card = page.locator('[data-testid="line04-preflight-card"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
  });
});
