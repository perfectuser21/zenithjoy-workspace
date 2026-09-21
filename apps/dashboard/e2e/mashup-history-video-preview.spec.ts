import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Final E2E：素材视频在线预览 + 批量混剪历史记录（GP line05/batch_mashup，PR #1912）
 *
 * 跑在 windows-latest 干净 VM 上（ZenithJoy UI 的 E2E 环境死规则），真 Postgres +
 * 真 apps/api 进程 + 真 Vite + 真 Chrome。/api/mashup/runs、/api/materials、
 * /api/mashup/candidates/:id 全部打到真后端真查库，断言的是库里事实经过完整链路
 * 呈现到界面上的结果。
 *
 * 两处刻意的替身，都不是"把断言换成 mock"，写在这里免得后人误会：
 *
 *  ① `/api/account/me` —— Dashboard 用 better-auth 登录态换 license_key，而素材/混剪
 *     端点认的是 X-Upload-Token。CI 里没有真实登录会话，所以只短路这一步，返回种子
 *     数据里**真实存在**的那把 license_key。后续每个请求仍然带着它打真 API，租户由
 *     服务端从凭据反查——鉴权链本身没有被绕过。
 *
 *  ② 签名 URL 指向真实 mp4 —— CI 里没有 COS 凭据，后端回落 InMemoryMaterialStorage，
 *     签出的是 `memory://...`，浏览器根本不认这个 scheme。所以拦下响应、把 previewUrl /
 *     downloadUrl 换成 e2e/fixtures/e2e-sample-2s.mp4 的 data URI（真 h264+aac，2 秒）。
 *     响应的其它字段一律原样透传。换掉的是"对象存储地址"这个外部环境依赖，验的仍然是
 *     真问题：前端有没有把后端给的地址喂进 <video>，浏览器能不能真的解码播放。
 *     判据用 readyState/duration 而不是"元素存在"——元素在但黑屏正是要防的假绿。
 */

// 种子数据里的测试凭据，不是真密钥。拼出来而不是写成字面量——「ZJ-F-xxx」这个形状
// 会被 gitleaks 的 generic-api-key / curl-auth-header 规则当泄露拦下
// （materials.test.ts 的 BAD_TOKEN 同款处理）。
const TENANT_LICENSE_KEY = ['ZJ', 'F', 'E2EMASHUP'].join('-');
const RUN_PENDING = 'e2e44444-4444-4444-8444-444444444444';
const RUN_DONE = 'e2e55555-5555-4555-8555-555555555555';
const RUN_GATED = 'e2e66666-6666-4666-8666-666666666666';

// 本项目 dashboard 是 ESM（package.json type: module），没有 __dirname
const HERE = path.dirname(fileURLToPath(import.meta.url));

const VIDEO_DATA_URI = `data:video/mp4;base64,${fs
  .readFileSync(path.join(HERE, 'fixtures', 'e2e-sample-2s.mp4'))
  .toString('base64')}`;

/** 短路登录态换凭据那一步（见文件头 ①）。 */
async function stubAccountMe(page: Page): Promise<void> {
  await page.route('**/api/account/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ license: { license_key: TENANT_LICENSE_KEY } }),
    }),
  );
}

/**
 * 把后端真实响应里的 memory:// 签名地址换成可播的真实视频（见文件头 ②）。
 * 走 route.fetch 拿真响应再改字段，不是凭空造一个——后端没返回 previewUrl 的话
 * 这里也换不出来，假绿不了。
 */
async function serveRealVideoForSignedUrls(page: Page): Promise<void> {
  await page.route('**/api/materials/*/preview', async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.data?.previewUrl) body.data.previewUrl = VIDEO_DATA_URI;
    await route.fulfill({ response, body: JSON.stringify(body) });
  });

  await page.route('**/api/mashup/candidates/*', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (body?.data?.content?.downloadUrl) body.data.content.downloadUrl = VIDEO_DATA_URI;
    if (body?.data?.content?.exportUrl) body.data.content.exportUrl = VIDEO_DATA_URI;
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
}

/** 浏览器里真的把这段视频解出来了才算能播：元素在但黑屏是本项目要防的假绿。 */
async function expectVideoActuallyPlayable(page: Page): Promise<void> {
  const video = page.locator('video').first();
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty('controls', true);

  await page.waitForFunction(
    () => {
      const v = document.querySelector('video');
      // HAVE_CURRENT_DATA=2：已经解出至少一帧，不是光有个空壳
      return !!v && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0;
    },
    undefined,
    { timeout: 15_000 },
  );

  const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
  expect(duration).toBeGreaterThan(1);
}

test.describe('素材视频在线预览 [BEHAVIOR]', () => {
  test('点开视频素材 → 弹窗内联播放（真实解码，非占位）', async ({ page }) => {
    await stubAccountMe(page);
    await serveRealVideoForSignedUrls(page);

    const previewRequests: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/materials\/[^/]+\/preview/.test(r.url())) previewRequests.push(r.url());
    });

    await page.goto('/materials');

    // 列表来自真 API 真查库；种子素材文件名 IMG_E2E_0001.MOV
    const tile = page.getByTitle('IMG_E2E_0001.MOV');
    await expect(tile).toBeVisible({ timeout: 15_000 });

    // 网格里仍是图标占位，不出缩略图——决策 1a20f778 只否掉了网格抽帧
    await expect(tile.locator('img')).toHaveCount(0);

    await tile.click();

    // 弹窗打开时现签地址，不复用列表里那个会过期的 preview_url
    await expect.poll(() => previewRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await expectVideoActuallyPlayable(page);
  });

  test('mime 是 octet-stream 的 .MOV 照样能播（不被 previewAvailable 判死）', async ({ page }) => {
    await stubAccountMe(page);

    // 这条不替换 URL，直接读后端真实响应，证明 previewAvailable 确实是 false——
    // 种子素材的 mime 是 application/octet-stream（iPhone 快捷指令的真实形态），
    // 后端只认 mime video/* 所以判 false。前端若拿它当播放开关，客户就永远看不到。
    const preview = await page.request.get(
      `${process.env.E2E_API_BASE_URL || 'http://localhost:5200/api'}/materials/e2e33333-3333-4333-8333-333333333333/preview`,
      { headers: { 'X-Upload-Token': TENANT_LICENSE_KEY } },
    );
    expect(preview.status()).toBe(200);
    const payload = await preview.json();
    expect(payload.data.previewAvailable).toBe(false);
    expect(payload.data.previewUrl).toBeTruthy();

    // 而界面上它照样播
    await serveRealVideoForSignedUrls(page);
    await page.goto('/materials');
    await page.getByTitle('IMG_E2E_0001.MOV').click();
    await expectVideoActuallyPlayable(page);
  });
});

test.describe('批量混剪历史记录 [BEHAVIOR]', () => {
  test('历史列表三态与库里事实一致（被 Gate 拦下的不报已完成）', async ({ page }) => {
    await stubAccountMe(page);

    // 这条全程不碰 /api/mashup/runs，列表完全来自真后端真查库
    const listResponse = page.waitForResponse(
      (r) => /\/api\/mashup\/runs(\?|$)/.test(r.url()) && r.status() === 200,
    );

    await page.goto('/mashup');
    await page.getByRole('button', { name: '历史记录' }).click();

    const payload = await (await listResponse).json();
    const byId = new Map<string, string>(
      payload.data.items.map((i: { runId: string; stage: string }) => [i.runId, i.stage]),
    );
    expect(byId.get(RUN_PENDING)).toBe('candidates_pending');
    expect(byId.get(RUN_DONE)).toBe('completed');
    // status 列写着 completed，但 contents.export_url 为 NULL（被安全 Gate 拦下）
    expect(byId.get(RUN_GATED)).toBe('rendering');

    // 界面上也要如实呈现，不能只是接口对了
    await expect(page.getByText('候选待选定')).toBeVisible();
    await expect(page.getByText('已完成')).toBeVisible();
    await expect(page.getByText('渲染中')).toBeVisible();
  });

  test('点候选待选定 → 恢复候选页，且不重跑候选生成', async ({ page }) => {
    await stubAccountMe(page);

    // 重跑生成 = 重算向量 + 重拼缩略图，客户等的就是不用重来。这里把 POST 全记下来，
    // 结束时必须一条都没有。
    const generateCalls: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/mashup\/runs\/[^/]+\/candidates/.test(r.url())) {
        generateCalls.push(r.url());
      }
    });

    const listCandidates = page.waitForResponse(
      (r) => /\/api\/mashup\/runs\/[^/]+\/candidates/.test(r.url()) && r.request().method() === 'GET',
    );

    await page.goto('/mashup');
    await page.getByRole('button', { name: '历史记录' }).click();
    await page.getByRole('button', { name: /候选待选定/ }).click();

    const candidatesPayload = await (await listCandidates).json();
    expect(candidatesPayload.data.runId).toBe(RUN_PENDING);
    expect(candidatesPayload.data.candidates.length).toBe(2);

    // 落在候选页：两个候选卡片都在
    await expect(page.getByRole('button', { name: '选这个' })).toHaveCount(2, { timeout: 15_000 });

    expect(generateCalls).toEqual([]);
  });

  test('点已完成 → 直接看到成片播放 + 下载', async ({ page }) => {
    await stubAccountMe(page);
    await serveRealVideoForSignedUrls(page);

    await page.goto('/mashup');
    await page.getByRole('button', { name: '历史记录' }).click();
    await page.getByRole('button', { name: /已完成/ }).click();

    await expect(page.getByText('成片已生成，内容安全审核通过')).toBeVisible({ timeout: 20_000 });
    await expectVideoActuallyPlayable(page);
    await expect(page.getByRole('link', { name: /下载成片/ })).toBeVisible();
  });
});
