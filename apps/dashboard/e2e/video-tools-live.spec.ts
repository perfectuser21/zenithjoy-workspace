import { test, expect, type Page } from '@playwright/test';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Explicit opt-in: this suite uses a real staging employee and paid providers.
// It never stubs authentication, API responses, queues, or generated media.
const STAGING = 'https://staging-autopilot.zenjoymedia.media';
test.use({ baseURL: STAGING, trace: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', retries: 0 });
test.skip(process.env.ZJ_VIDEO_LIVE !== 'true', 'Requires explicit live staging acceptance authorization');

async function signIn(page: Page) {
  const filename = process.env.ZJ_VIDEO_CREDENTIALS_FILE;
  if (!filename) throw new Error('Provide the dedicated 1Password test-account cache');
  const st = lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink() || realpathSync(filename) !== filename || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600) {
    throw new Error('Test credentials must be an owned canonical mode-600 file');
  }
  const credentials = JSON.parse(readFileSync(filename, 'utf8'));
  if (credentials.username !== 'ai-acceptance@zenithjoy.test' || typeof credentials.password !== 'string') {
    throw new Error('Only the dedicated staging acceptance account is permitted');
  }
  await page.goto('/login');
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill(credentials.username);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  const loggedIn = page.waitForResponse(r => r.url() === `${STAGING}/api/auth/sign-in/email` && r.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await loggedIn).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  const session = await page.request.get(`${STAGING}/api/auth/get-session`);
  expect((await session.json()).user.email).toBe(credentials.username);
}

test('真实员工可进入Wan、Aidge及本人画布，未登录请求仍拒绝', async ({ page, playwright }, info) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto('/wan-playground');
  await expect(page.getByRole('heading', { name: 'Wan Playground', exact: true })).toBeVisible();
  const config = await page.request.get(`${STAGING}/api/video-tools/config`);
  expect(config.status()).toBe(200);
  expect(await config.json()).toMatchObject({ wan: { configured: true }, upscale: { configured: true }, uploads: { configured: true } });
  await page.goto('/aidge');
  const access = await page.request.get(`${STAGING}/api/aidge/access`);
  expect(await access.json()).toEqual({ role: 'staff' });
  await page.goto('/creative-canvas');
  await expect(page.getByRole('heading', { name: '视频创作画布', exact: true })).toBeVisible();
  const status = await page.request.get(`${STAGING}/api/creative-canvas/status`);
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ available: true });
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('canvas').first()).toBeVisible({ timeout: 120_000 });
  const openWorkflow = page.getByRole('button', { name: '打开短视频分镜工作流' });
  await expect(openWorkflow).toBeEnabled({ timeout: 120_000 });
  const templateResponse = page.waitForResponse(r => r.url() === `${STAGING}/api/creative-canvas/extensions/zenithjoy/short-video-wan.json`);
  await openWorkflow.click();
  const template = await templateResponse;
  expect(template.status()).toBe(200);
  const expectedTypes = (await template.json()).nodes.map((node: { type: string }) => node.type);
  await expect(openWorkflow).toBeEnabled();
  await expect.poll(async () => frame.locator('canvas').first().evaluate(() => {
    const app = (window as Window & { app?: { graph?: { _nodes?: Array<{ type: string }> } } }).app;
    return (app?.graph?._nodes ?? []).map(node => node.type).sort();
  })).toEqual([...expectedTypes].sort());
  await expect(page.getByText('工作流打开失败', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('private-canvas.png') });
  const guest = await playwright.request.newContext({ baseURL: STAGING });
  try {
    expect((await guest.get('/api/video-tools/config')).status()).toBe(401);
    expect((await guest.get('/api/creative-canvas/status')).status()).toBe(401);
  } finally { await guest.dispose(); }
});

for (const kind of ['wan', 'upscale'] as const) {
  test(`真实${kind}任务经页面单次提交，刷新后独立下载验证成片`, async ({ page }, info) => {
    test.setTimeout(900_000);
    await signIn(page);
    await page.goto(kind === 'wan' ? '/wan-playground' : '/video-upscale');
    if (kind === 'wan') {
      await page.getByLabel('视频描述').fill('一颗红色小球静置在白色桌面，固定镜头，柔和光线，无文字。');
      await page.getByLabel('清晰度').selectOption('480P');
      await page.getByLabel('时长（秒）').fill('2');
      await page.getByLabel('同时生成声音').uncheck();
    } else {
      const fixture = info.outputPath('synthetic-input.mp4');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=480x480:rate=12', '-t', '2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
      const input = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', fixture], { encoding: 'utf8' }));
      expect(input.streams).toEqual([{ codec_type: 'video', width: 480, height: 480 }]);
      expect(Number(input.format.duration)).toBeCloseTo(2, 1);
      const uploaded = page.waitForResponse(r => r.url().startsWith(`${STAGING}/api/video-tools/uploads/`) && r.url().endsWith('/complete') && r.request().method() === 'POST');
      await page.getByLabel('上传待超分视频').setInputFiles(fixture);
      const receipt = await uploaded;
      expect(receipt.status()).toBe(200);
      const asset = await receipt.json(), privateUrl = new URL(asset.url);
      expect(privateUrl.protocol).toBe('https:');
      expect(privateUrl.hostname.endsWith('.myqcloud.com')).toBe(true);
      privateUrl.search = ''; privateUrl.hash = '';
      expect((await page.request.get(privateUrl.href)).status()).toBe(403);
    }
    const button = page.getByRole('button', { name: kind === 'wan' ? '生成视频' : '开始超分', exact: true });
    await expect(button).toBeEnabled({ timeout: 120_000 });
    const submitted = page.waitForResponse(r => r.url() === `${STAGING}/api/video-tools/jobs` && r.request().method() === 'POST');
    await button.click(); // Never retry a submit, including unknown outcomes.
    const receipt = await submitted;
    expect(receipt.status()).toBe(202);
    const job = await receipt.json();
    expect(job.id).toMatch(/^[a-f0-9-]{36}$/);
    writeFileSync(info.outputPath('submission.json'), JSON.stringify({ id: job.id, kind, submitted: true, source: STAGING }) + '\n');
    await expect(page.getByTestId('video-result')).toBeVisible({ timeout: 720_000 });
    const result = await page.request.get(`${STAGING}/api/video-tools/jobs/${job.id}`);
    expect(await result.json()).toMatchObject({ id: job.id, status: 'succeeded' });
    await page.reload();
    await page.getByRole('button').filter({ hasText: kind === 'wan' ? '视频生成' : '视频超分' }).filter({ hasText: '已完成' }).first().click();
    await expect(page.getByTestId('video-result')).toBeVisible();
    await expect(page.getByRole('link', { name: '下载视频' })).toHaveAttribute('href', `/api/video-tools/jobs/${job.id}/download?download=1`);
    const download = await page.request.get(`${STAGING}/api/video-tools/jobs/${job.id}/download`);
    expect(download.status()).toBe(200);
    const bytes = await download.body(), filename = info.outputPath('result.mp4');
    writeFileSync(filename, bytes);
    const media = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', filename], { encoding: 'utf8' }));
    expect(Number(media.format.duration)).toBeGreaterThanOrEqual(1.8);
    expect(Number(media.format.duration)).toBeLessThanOrEqual(2.3);
    const video = media.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    expect(video).toBeDefined();
    expect(media.streams.filter((stream: { codec_type: string }) => stream.codec_type === 'audio')).toHaveLength(0);
    if (kind === 'upscale') expect(video).toMatchObject({ width: 960, height: 960 });
    else expect(Math.min(video.width, video.height)).toBe(480);
    writeFileSync(info.outputPath('verified-result.json'), JSON.stringify({ id: job.id, kind, sha256: createHash('sha256').update(bytes).digest('hex'), media }) + '\n');
    await page.screenshot({ path: info.outputPath('completed.png') });
  });
}
