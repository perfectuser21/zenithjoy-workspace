// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';

const BASE  = 'https://autopilot.zenjoymedia.media';
// URL-decode in case token was copied from Set-Cookie header (contains %2B, %3D for +, =)
const rawToken = process.env.ZJ_SESSION_TOKEN || '';
let TOKEN = rawToken;
try { TOKEN = decodeURIComponent(rawToken); } catch { /* already decoded */ }
const VIDEO = process.env.VIDEO_PATH || 'C:\\Users\\runneradmin\\Videos\\zj-e2e-koubo-45s.mp4';
// E2E test license key — stamps license_id on job creation so tenant isolation works correctly
const E2E_LICENSE = process.env.ZJ_E2E_LICENSE_KEY || 'ZJ-F-FBFYTLFR'; // gitleaks:allow — E2E test license

test('Agent E2E — 口播视频本地生成全链路', async ({ page, context }) => {
  test.setTimeout(1200000); // 20 min total test budget

  console.log('[e2e] step 1: 注入 session cookie');
  // better-auth on HTTPS uses __Secure- prefixed cookie name
  await context.addCookies([{
    name: '__Secure-better-auth.session_token',
    value: TOKEN,
    domain: 'autopilot.zenjoymedia.media',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  }]);

  // Capture job ID from the POST response for direct status polling.
  let jobId = null;
  await page.route('**/api/ai-video/jobs', async (route) => {
    if (route.request().method() === 'POST') {
      const headers = await route.request().allHeaders();
      // Inject license key so API stamps license_id — session-based lookup fails for non-Feishu users.
      const resp = await route.fetch({ headers: { ...headers, authorization: `Bearer ${E2E_LICENSE}` } });
      const body = await resp.json().catch(() => ({}));
      // API returns { job: { id, status, ... } }
      const jobData = body?.job ?? body;
      if (jobData?.id) { jobId = jobData.id; console.log('[e2e] job created:', jobId); }
      await route.fulfill({ response: resp });
    } else {
      await route.continue();
    }
  });

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
  // No template selected — tests non-template 9:16 vstack path (original footage top + text bottom)
  // Select 9:16 aspect ratio if present
  const aspect916 = page.locator('[value="9:16"]');
  if (await aspect916.count() > 0) {
    await aspect916.first().click();
    console.log('[e2e] step 3: selected 9:16 aspect ratio');
  }
  // topic textarea (first)
  await page.locator('textarea').first().fill('ZenithJoy E2E 测试口播视频处理，验证 hyperframes 字幕渲染');
  // original_script textarea (second, if present)
  const scriptTextarea = page.locator('textarea[name="original_script"]');
  if (await scriptTextarea.count() > 0) {
    await scriptTextarea.fill('E2E original_script test content');
    console.log('[e2e] step 3: filled original_script');
  }
  await page.screenshot({ path: 'screenshots/ws3-03-form-filled.png', fullPage: true });

  console.log('[e2e] step 4: 开始处理');
  await page.click('button:has-text("开始处理")');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'screenshots/ws3-04-submitted.png', fullPage: true });
  console.log('[e2e] job ID:', jobId);

  console.log('[e2e] step 5: 等待完成 (max 15min)');
  const startTs = Date.now();
  const deadline = startTs + 900000; // 15 minutes
  let done = false;
  let lastApiStatus = 'unknown';

  while (Date.now() < deadline) {
    const elapsed = Math.round((Date.now() - startTs) / 1000);

    // Primary check: page text (UI-level)
    const body = await page.textContent('body').catch(() => '');
    const hasDone = body.includes('处理完成') || body.includes('下载 9:16');
    const hasFail = body.includes('处理失败') || body.includes('failed');

    // Secondary check: direct API poll (bypasses potential UI refresh issues)
    if (jobId) {
      try {
        const apiResp = await page.evaluate(async ({ id, lic }) => {
          const r = await fetch(`/api/ai-video/jobs/${id}`, { headers: { Authorization: `Bearer ${lic}` } });
          return r.ok ? r.json() : null;
        }, { id: jobId, lic: E2E_LICENSE });
        if (apiResp) {
          lastApiStatus = `${apiResp.status}/${apiResp.progress}%`;
          if (apiResp.status === 'completed') {
            done = true;
            console.log(`[e2e] ${elapsed}s API 完成 ✓`);
            break;
          }
          if (apiResp.status === 'failed') {
            console.error(`[e2e] ${elapsed}s API 失败: ${apiResp.error_msg}`);
            break;
          }
        }
      } catch (e) { /* non-fatal */ }
    }

    await page.screenshot({ path: `screenshots/progress-${elapsed}s.png` });
    console.log(`[e2e] ${elapsed}s page:done=${hasDone} fail=${hasFail} api:${lastApiStatus}`);

    if (hasDone) { done = true; console.log('[e2e] 页面完成！'); break; }
    if (hasFail) { console.error('[e2e] 页面失败'); break; }

    // Reload every 60s to force UI refresh (page might not auto-update)
    if (elapsed > 0 && elapsed % 60 < 10) {
      await page.reload().catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      await page.waitForTimeout(10000);
    }
  }

  await page.screenshot({ path: 'screenshots/ws3-05-final.png', fullPage: true });
  expect(done, `视频应在 15 分钟内处理完成 (last api status: ${lastApiStatus})`).toBe(true);

  // Verify output quality and write job metadata for GHA ffprobe verification
  if (jobId) {
    const jobResp = await page.evaluate(async ({ id, lic }) => {
      const r = await fetch(`/api/ai-video/jobs/${id}`, { headers: { Authorization: `Bearer ${lic}` } });
      return r.ok ? r.json() : null;
    }, { id: jobId, lic: E2E_LICENSE });
    if (jobResp) {
      console.log(`[e2e] detected_aspect=${jobResp.detected_aspect} target_aspect=${jobResp.target_aspect} output_dir=${jobResp.output_dir}`);
      expect(['9:16', '16:9', null]).toContain(jobResp.detected_aspect);
      expect(jobResp.output_dir, 'output_dir must be set — pipeline must produce a file').toBeTruthy();
      // Write job metadata for GHA post-test ffprobe verification
      fs.writeFileSync('e2e-job-result.json', JSON.stringify({
        jobId,
        outputDir: jobResp.output_dir,
        detectedAspect: jobResp.detected_aspect,
        targetAspect: jobResp.target_aspect,
      }));
      console.log('[e2e] job metadata written to e2e-job-result.json');
    }
  }
});
