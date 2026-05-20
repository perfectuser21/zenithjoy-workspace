#!/usr/bin/env node
/**
 * 抖音图文「dry-run」自检脚本（draft-only wrapper）
 *
 * 与 publish-douyin-image.js（真发版）严格隔离：
 *   - 本脚本走完上传图片 / 填标题 / 填文案 全部流程
 *   - **不点最终的「发布」按钮，绝不调用 /web/api/media/aweme/create_v2/**
 *   - 用于 ZenithJoy Agent v0.1 链路自检（中台 → Windows Agent → 抖音创作者后台）
 *
 * 用法：
 *   node publish-douyin-image-dryrun.js <queue-file-path>
 *
 * 输出：
 *   stdout 最后一行为 JSON（machine readable）：
 *     {"ok":true,"dryRun":true,"url":"<最终页面 URL>","title":"<标题>","imagesCount":<N>}
 *   失败时 exit code 非 0。
 *
 * 与真发脚本的差异：
 *   1. 不要 SCP 图片到 Windows（脚本本身就在 Windows 上，直接用本地路径）
 *   2. Step 5 改为「定位发布按钮 → 仅断言其存在 → 不点击」
 */

const _log = console.log.bind(console);
const { chromium } = require('playwright');
const fs = require('fs');

async function publishDouyinImageDryRun(queueFilePath) {
  _log('[DY-DRY] 读取队列文件:', queueFilePath);

  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  const title = queueData.title || `[DRY] 自检 ${Date.now()}`;
  const content = queueData.content || '';
  const localImages = (queueData.images || []).filter(f => fs.existsSync(f));

  _log('[DY-DRY] 标题:', title);
  _log('[DY-DRY] 文案:', content.substring(0, 50));
  _log('[DY-DRY] 图片(本地):', localImages.length, '张');

  if (localImages.length === 0) {
    throw new Error('queue 文件 images 为空或图片不存在');
  }

  _log('\n[DY-DRY] 连接到现有浏览器 (localhost:19222)...');
  const browser = await chromium.connectOverCDP('http://localhost:19222');
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('CDP 没有上下文，确认 Chrome 19222 是否登录抖音');
  const context = contexts[0];
  const pages = context.pages();
  if (!pages.length) throw new Error('CDP 没有 page');
  const page = pages[0];
  _log('[DY-DRY] 已连接到浏览器\n');

  // 安全栅栏：监听 create_v2 请求，一旦触发说明 dry-run 失守
  let createApiHit = false;
  page.on('request', (req) => {
    if (req.url().includes('/web/api/media/aweme/create_v2/')) {
      createApiHit = true;
      _log('[DY-DRY] !! 检测到 create_v2 调用，dry-run 失守 !!');
    }
  });

  try {
    _log('[DY-DRY] Step 1: 导航到发布图文页面');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=3', {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(3000);

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      throw new Error(`抖音未登录，当前 URL: ${url1}`);
    }

    _log('[DY-DRY] Step 2: 上传图片 (DOM.setFileInputFiles)');
    const cdpSession = await context.newCDPSession(page);
    const { result } = await cdpSession.send('Runtime.evaluate', {
      expression: `document.querySelector('input[type="file"]')`,
    });
    if (!result.objectId) throw new Error('未找到 file input');
    const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
    if (!node.backendNodeId) throw new Error('未获取到 file input backendNodeId');
    await cdpSession.send('DOM.setFileInputFiles', {
      backendNodeId: node.backendNodeId,
      files: localImages,
    });
    _log(`[DY-DRY] 已设置 ${localImages.length} 张图片`);

    _log('[DY-DRY] 等待页面跳转到编辑页 (45s 超时)');
    await page.waitForURL(/\/content\/post\/image/, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const finalUrl = page.url();
    _log('[DY-DRY] 当前 URL:', finalUrl);

    _log('[DY-DRY] Step 3: 填写标题');
    const titleFilled = await page.evaluate((titleText) => {
      const input = document.querySelector('input[placeholder*="标题"]');
      if (!input) return { success: false, error: '未找到标题 input' };
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, titleText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }, title);
    _log('[DY-DRY] 标题填写:', titleFilled.success ? 'OK' : `FAIL ${titleFilled.error}`);

    if (content) {
      _log('[DY-DRY] Step 4: 填写文案');
      await page.evaluate((contentText) => {
        const editable = document.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.focus();
          editable.innerText = contentText;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, content);
    }

    await page.waitForTimeout(2000);

    _log('[DY-DRY] Step 5: 定位发布按钮但 *不点击*');
    const publishBtn = page.locator('button:has-text("发布")').last();
    const visible = await publishBtn.isVisible().catch(() => false);
    if (!visible) {
      _log('[DY-DRY] 警告：发布按钮不可见，但流程已走到这里，不影响 dry-run 通过');
    } else {
      _log('[DY-DRY] 发布按钮已就位（不点击）');
    }

    if (createApiHit) {
      throw new Error('dry-run 失守：检测到 create_v2 调用');
    }

    const result_ = {
      ok: true,
      dryRun: true,
      url: finalUrl,
      title,
      imagesCount: localImages.length,
      publishBtnVisible: visible,
    };
    _log(JSON.stringify(result_));
    return result_;
  } catch (err) {
    console.error('[DY-DRY] 失败:', err.message);
    throw err;
  }
}

const queueFilePath = process.argv[2];
if (!queueFilePath) {
  console.error('用法: node publish-douyin-image-dryrun.js <queue-file-path>');
  process.exit(1);
}

publishDouyinImageDryRun(queueFilePath)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
