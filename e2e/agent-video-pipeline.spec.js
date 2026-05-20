// @ts-check
const { test, expect } = require('@playwright/test');

const BASE  = 'https://autopilot.zenjoymedia.media';
const TOKEN = process.env.ZJ_SESSION_TOKEN;
const VIDEO = process.env.VIDEO_PATH || 'C:\\Users\\runneradmin\\Videos\\zj-e2e-koubo-45s.mp4';

test('Agent E2E — 口播视频本地生成全链路', async ({ page, context }) => {
  test.setTimeout(600000);

  console.log('[e2e] step 1: 注入 session cookie');
  await context.addCookies([{
    name: 'better-auth.session_token',
    value: TOKEN,
    domain: 'autopilot.zenjoymedia.media',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  }]);
  await page.goto(BASE + '/');
  await page.waitForTimeout(2000);
  console.log('[e2e] 已注入 cookie，当前 URL:', page.url());
  await page.screenshot({ path: 'screenshots/01-home.png', fullPage: true });

  console.log('[e2e] step 2: /local-video');
  await page.goto(BASE + '/local-video');
  await page.waitForSelector('text=视频本地路径', { timeout: 20000 });
  await page.screenshot({ path: 'screenshots/02-local-video.png', fullPage: true });

  console.log('[e2e] step 3: 填写路径', VIDEO);
  await page.fill('input[placeholder*="mp4"]', VIDEO);
  await page.fill('textarea', 'ZenithJoy E2E 测试口播视频处理，验证 hyperframes 字幕渲染');
  await page.screenshot({ path: 'screenshots/03-form-filled.png', fullPage: true });

  console.log('[e2e] step 4: 开始处理');
  await page.click('button:has-text("开始处理")');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/04-submitted.png', fullPage: true });

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

  await page.screenshot({ path: 'screenshots/05-final.png', fullPage: true });
  expect(done, '视频应在 8 分钟内处理完成').toBe(true);
});
