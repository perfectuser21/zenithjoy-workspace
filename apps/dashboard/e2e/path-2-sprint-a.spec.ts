/**
 * Path 2 Sprint A 飞书集成 — Playwright E2E 8 步全链
 *
 * 全 API stub（page.route），不依赖真后端 + 真飞书。
 *
 * 8 步映射 Golden Path：
 *   step1: dashboard 加载 /dashboard/feishu-bind 显示未绑定表单
 *   step2: 填 app_id + app_secret 提交 → fetch /api/feishu/oauth/start → 跳 authorize_url
 *   step3: 模拟 callback 后回到页面（已绑定状态）显示「飞书已绑定 ✓」+ Bitable 链接
 *   step4: 点「刷新状态」 fetch /api/lead-config → 渲染获客画像 + 对标视频
 *   step5: 渲染装修 / 小户型 / 钩子文案 — 数据展示成功
 *   step6: 对标视频 1 个数量验证
 *   step7: R5 模拟 TOKEN_REFRESH_FAILED → 显示重新授权按钮
 *   step8 出口标记: 整 spec 走完 PASS
 */
import { test, expect } from '@playwright/test';

test('path-2-sprint-a 客户绑飞书 8 步全链', async ({ page }) => {
  // ============ stub /api/feishu/oauth/status ============
  // 页面初始 fetch status 判定未绑定→渲染表单;0-touch 提交后页面自行 setStatus(已绑定),不再查此接口
  // (页面已从 OAuth 跳转重构为 0-touch 同步绑定,spec 随之重写——巡检 2026-07-12 收编修复)
  await page.route('**/api/feishu/oauth/status*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { bound: false } }),
    });
  });

  // stub 0-touch 同步绑定:提交 app_id/app_secret → 后端建 Bitable 返回 app_token + bitable_doc_url
  await page.route('**/api/feishu/oauth/bind', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          app_token: 'bascnFakeAppToken123',
          bitable_doc_url: 'https://example.feishu.cn/base/bascnFakeAppToken123',
        },
      }),
    });
  });

  // stub /api/lead-config → 默认成功，第二次模拟 R5 TOKEN_REFRESH_FAILED
  let leadConfigCalls = 0;
  await page.route('**/api/lead-config/**', async (route) => {
    leadConfigCalls += 1;
    if (leadConfigCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            profile: { industry: '装修', keyword: '小户型', hook: '送装修方案 PDF' },
            target_videos: [{ url: 'https://v.douyin.com/test/', note: 'smoke' }],
          },
        }),
      });
    } else {
      // step7: R5 TOKEN_REFRESH_FAILED
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'TOKEN_REFRESH_FAILED', message: 'token 失效' },
        }),
      });
    }
  });

  // step1: 加载页 → 显示未绑定表单
  await page.goto('/dashboard/feishu-bind');
  await expect(page.getByLabel(/app_id|App ID/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel(/app_secret|App Secret/i)).toBeVisible();

  // step2: 填表 + 提交（不真跳转，因 stub）
  await page.getByLabel(/app_id|App ID/i).fill('cli_smoke_app');
  await page.getByLabel(/app_secret|App Secret/i).fill('smoke_secret');
  await page.getByRole('button', { name: /开始绑定|绑定/i }).click();

  // step3: 0-touch 提交成功后页面直接切已绑定态(不再走 OAuth callback 跳回)
  await expect(page.getByText(/飞书已绑定/)).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByRole('link', { name: /Bitable|多维表格/i })
  ).toHaveAttribute('href', /feishu\.cn\/base\//);

  // step4: 点「刷新状态」 → 拉 lead-config
  await page.getByRole('button', { name: /刷新状态/i }).click();

  // step5/step6: 渲染数据
  await expect(page.getByText('装修', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('小户型')).toBeVisible();
  await expect(page.getByText(/送装修方案/)).toBeVisible();
  await expect(page.getByText(/对标视频.*1\s*个/)).toBeVisible();

  // step7: 再点刷新（leadConfigCalls=2） → R5 TOKEN_REFRESH_FAILED → 「重新授权飞书」按钮
  await page.getByRole('button', { name: /刷新状态/i }).click();
  await expect(page.getByRole('button', { name: /重新授权飞书/i })).toBeVisible({ timeout: 5000 });

  // step8: 出口标记（spec 跑完 PASS）
  console.log('[step8] Path 2 Sprint A E2E 8 步全链 PASS');
});
