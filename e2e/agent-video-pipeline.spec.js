// @ts-check
const { test, expect } = require('@playwright/test');

const BASE  = 'https://autopilot.zenjoymedia.media';
const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const VIDEO = process.env.VIDEO_PATH || 'C:\\Users\\runneradmin\\Videos\\zj-e2e-koubo-45s.mp4';

test('Agent E2E — 口播视频本地生成全链路', async ({ page }) => {
  test.setTimeout(600000);

  console.log('[e2e] step 1: 登录');
  await page.goto(BASE + '/login');
  await page.fill('#si-email', EMAIL);
  await page.fill('#si-password', PASS);
  await page.screenshot({ path: 'screenshots/01-login.png', fullPage: true });
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.includes('/login'), { timeout: 20000 });
  console.log('[e2e] 登录成功:', page.url());
  await page.screenshot({ path: 'screenshots/02-dashboard.png', fullPage: true });

  console.log('[e2e] step 2: /local-video');
  await page.goto(BASE + '/local-video');
  await page.waitForSelector('text=视频本地路径', { timeout: 20000 });
  await page.screenshot({ path: 'screenshots/03-local-video.png', fullPage: true });

  console.log('[e2e] step 3: 填写路径', VIDEO);
  await page.fill('input[placeholder*="mp4"]', VIDEO);
  await page.fill('textarea', 'ZenithJoy E2E 测试口播视频处理，验证 hyperframes 字幕渲染');
  await page.screenshot({ path: 'screenshots/04-form-filled.png', fullPage: true });

  console.log('[e2e] step 4: 开始处理');
  await page.click('button:has-text("开始处理")');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/05-submitted.png', fullPage: true });

  console.log('[e2e] step 5: 等待完成 (max 8min)');
  const startTs = Date.now();
  const deadline = startTs + 480000;
  let done = false;

  while (Date.now() < deadline) {
    const elapsed = Math.round((Date.now() - startTs) / 1000);
    const body = await page.textContent('body').catch(() => '');
    const hasDone = body.includes('处理完成') || body.includes('下载');
    const hasFail = body.includes('处理失败') || body.includes('failed');
    await page.screenshot({ path: `screenshots/progress-${elapsed}s.png` });
    console.log(`[e2e] ${elapsed}s done:${hasDone} fail:${hasFail}`);
    if (hasDone) { done = true; console.log('[e2e] 完成！'); break; }
    if (hasFail) { console.error('[e2e] 失败'); break; }
    await page.waitForTimeout(5000);
  }

  await page.screenshot({ path: 'screenshots/06-final.png', fullPage: true });
  expect(done, '视频应在 8 分钟内处理完成').toBe(true);
});
