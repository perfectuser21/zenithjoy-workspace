const _log = console.log.bind(console);
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CDP_URL = 'http://100.97.242.124:19230';
const UPLOAD_URL = 'https://www.zhihu.com/upload-video';
const SCREENSHOTS_DIR = '/tmp/zhihu-video-publish';
const SUCCESS_SCREENSHOT = '/tmp/zhihu-video-success.png';

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--title') {
      args.title = argv[++i];
      continue;
    }
    if (arg === '--video') {
      args.video = argv[++i];
      continue;
    }
    if (arg === '--desc') {
      args.desc = argv[++i];
      continue;
    }
  }
  return args;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(message) {
  _log(`[ZhihuVideo] ${message}`);
}

function fail(message) {
  console.error(`[ZhihuVideo] ${message}`);
  process.exit(1);
}

async function screenshot(page, name, targetPath) {
  ensureDir(SCREENSHOTS_DIR);
  const file = targetPath || path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log(`截图: ${file}`);
  return file;
}

async function connectBrowser() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] || (await browser.newContext());
  return { browser, context };
}

async function getOrCreatePage(context, predicate) {
  const existing = context.pages().find(predicate);
  if (existing) return existing;
  return context.newPage();
}

async function dismissDraftDialog(page) {
  const ignore = page.getByRole('button', { name: '忽略' });
  if ((await ignore.count()) > 0) {
    await ignore.first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}

async function openUploadPage(context) {
  const page = await getOrCreatePage(context, p => p.url().includes('/upload-video'));
  await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await dismissDraftDialog(page);
  await screenshot(page, '01-upload-page');
  return page;
}

async function uploadAndPublish(page, localVideo, title, desc) {
  const fileBuffer = fs.readFileSync(localVideo);
  const base64 = fileBuffer.toString('base64');
  const ext = path.extname(localVideo).toLowerCase();
  const mimeType = ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';

  const result = await page.evaluate(
    async ({ base64Data, filename, mimeType, publishTitle, publishDesc }) => {
      function decodeBase64(input) {
        const binary = atob(input);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      function getWebpackRequire() {
        let req;
        (window.webpackChunkheifetz || window.webpackChunk).push([[Symbol('zhihu-video')], {}, r => { req = r; }]);
        return req;
      }

      async function uploadVideo(req, file) {
        const UploadManager = req('38341').Z;
        const appConfig = req('80714').Z;
        const manager = new UploadManager({
          usage: 'pin_video',
          apiRoot: appConfig.fetchRoot.lens,
          source: 'pin',
          noSizeCheck: true,
          useSignature: true,
        });
        const session = manager.getSession('video', file);
        return new Promise((resolve, reject) => {
          session.on('complete', resolve);
          session.on('error', reject);
          session.start();
        });
      }

      async function publishPin(req, uploaded, title, desc) {
        const Builder = req('27521').y;
        const appConfig = req('80714').Z;
        const builder = new Builder();
        const displayText = desc ? `${title}\n${desc}` : title;

        builder.set('publish', { traceId: `${Date.now()}` });
        builder.set('commentsPermission', { comment_permission: 'all' });
        builder.setExtraInfo('view_permission', 'all');
        builder.setExtraInfo('publisher', 'pc');
        builder.setDraft('disabled', 1);
        builder.set('title', { title });
        builder.addMedia({
          video: {
            cover: {
              originalUrl: uploaded.thumbnail,
              width: 0,
              height: 0,
            },
            videoId: uploaded.id,
            width: 0,
            height: 0,
          },
        });
        builder.set('originalReprint', { originalReprint: 'original' });

        if (displayText) {
          builder.set('hybrid', {
            html: `<div>${displayText.replace(/\n/g, '<br/>')}</div>`,
            textLength: displayText.length,
          });
        }

        const payload = builder.build();
        const resp = await fetch(`${appConfig.fetchRoot.www}/api/v4/content/publish`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'pin', data: payload }),
        });

        const rawText = await resp.text();
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          throw new Error(`发布响应非 JSON: ${rawText.slice(0, 300)}`);
        }

        if (!resp.ok || parsed.code !== 0 || !parsed?.data?.result) {
          throw new Error(`发布失败: ${rawText.slice(0, 500)}`);
        }

        const pin = JSON.parse(parsed.data.result);
        return {
          payload,
          pin,
          raw: parsed,
        };
      }

      const req = getWebpackRequire();
      const bytes = decodeBase64(base64Data);
      const file = new File([bytes], filename, { type: mimeType, lastModified: Date.now() });
      const uploaded = await uploadVideo(req, file);
      const published = await publishPin(req, uploaded, publishTitle, publishDesc || '');

      return {
        uploaded,
        published,
      };
    },
    {
      base64Data: base64,
      filename: path.basename(localVideo),
      mimeType,
      publishTitle: title,
      publishDesc: desc || '',
    }
  );

  return result;
}

async function openResultPage(context, pinId) {
  const page = await context.newPage();
  const url = `https://www.zhihu.com/pin/${pinId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  await screenshot(page, '02-publish-result');
  await screenshot(page, 'success', SUCCESS_SCREENSHOT);
  return { page, url };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title) fail('必须提供 --title');
  if (!args.video) fail('必须提供 --video');
  if (!fs.existsSync(args.video)) fail(`视频不存在: ${args.video}`);

  if (args.dryRun) {
    log(`dry-run title=${args.title}`);
    log(`dry-run video=${args.video}`);
    log(`dry-run desc.length=${(args.desc || '').length}`);
    return;
  }

  ensureDir(SCREENSHOTS_DIR);

  log('========================================');
  log('知乎视频发布 (Playwright + CDP + in-browser API)');
  log(`CDP: ${CDP_URL}`);
  log(`标题: ${args.title}`);
  log(`视频: ${args.video}`);
  log(`描述长度: ${(args.desc || '').length}`);
  log('========================================');

  const { browser, context } = await connectBrowser();
  try {
    const uploadPage = await openUploadPage(context);
    const result = await uploadAndPublish(uploadPage, args.video, args.title, args.desc || '');
    const pin = result?.published?.pin;
    const pinId = pin?.id;

    if (!pinId) {
      throw new Error(`发布成功响应缺少 pin id: ${JSON.stringify(result?.published?.raw || {})}`);
    }

    const { url } = await openResultPage(context, pinId);
    log(`上传成功，videoId=${result.uploaded.id}`);
    log(`发布成功，pinId=${pinId}`);
    log(`结果页: ${url}`);
    log(`成功截图: ${SUCCESS_SCREENSHOT}`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[ZhihuVideo] 失败: ${error.stack || error.message}`);
    process.exit(1);
  });
}
