/**
 * content-judgment-gate.spec.ts — Playwright E2E
 * commit-1 Red: 在 UI 实现（commit-6）之前会 FAIL
 *
 * 验收条件：
 *   1. AcquisitionConfigPage 渲染 target_profile_desc textarea
 *   2. LeadsPage 渲染 outreach_eligible 状态列（显示「可触达」/「不触达」）
 */
import { test, expect } from '@playwright/test';

test.describe('content-judgment-gate UI', () => {
  /**
   * AcquisitionConfigPage 应渲染 target_profile_desc textarea
   * 让用户填写目标客户画像描述（供 Gemini 判断视频内容是否匹配）
   */
  test('AcquisitionConfigPage renders target_profile_desc textarea', async ({ page }) => {
    await page.goto('/dashboard/acquisition-config');

    // 等待页面加载完成
    await page.waitForLoadState('networkidle');

    // 查找 target_profile_desc textarea
    // 可能以 label 文本「目标客户画像」或 aria-label / placeholder 形式出现
    const profileDescArea = page.locator(
      'textarea[name="target_profile_desc"], ' +
      'textarea[aria-label*="目标客户画像"], ' +
      'textarea[placeholder*="目标客户"], ' +
      '[data-testid="target-profile-desc"]'
    );

    await expect(profileDescArea).toBeVisible({
      timeout: 10_000,
    });

    // 验证可以输入内容
    await profileDescArea.fill('中小企业主，关注降本增效，有数字化转型需求');
    const value = await profileDescArea.inputValue();
    expect(value).toContain('中小企业主');
  });

  /**
   * LeadsPage 应渲染 outreach_eligible 状态列
   * 显示「可触达」（outreach_eligible=true）或「不触达」（outreach_eligible=false）
   */
  test('LeadsListPage renders outreach_eligible status column showing 「可触达」/「不触达」', async ({ page }) => {
    await page.goto('/dashboard/leads');

    // 等待页面加载完成
    await page.waitForLoadState('networkidle');

    // 验证表头包含「触达状态」或「可触达」列
    const eligibleHeader = page.locator(
      '[role="columnheader"]:has-text("触达状态"), ' +
      '[role="columnheader"]:has-text("可触达"), ' +
      'th:has-text("触达状态"), ' +
      'th:has-text("outreach_eligible")'
    );

    await expect(eligibleHeader).toBeVisible({
      timeout: 10_000,
    });
  });
});
