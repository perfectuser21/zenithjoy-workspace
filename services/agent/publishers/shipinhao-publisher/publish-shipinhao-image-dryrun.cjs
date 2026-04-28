#!/usr/bin/env node
/**
 * 视频号图文「dry-run」自检脚本（draft-only wrapper）
 *
 * 与 publish-shipinhao-image.cjs（真发版）严格隔离：
 *   - 只 CDP 连接到 Windows Chrome (端口 19228)
 *   - 验证已登录视频号助手
 *   - **绝不上传图片、绝不填表单、绝不点击发布按钮**
 *   - 拦截疑似发布 API（/cgi-bin/mmfinderassistant-bin/post 等），命中即 dry-run 失守
 *
 * 用法：
 *   node publish-shipinhao-image-dryrun.cjs <queue-file-path>
 */

'use strict';

const _log = console.log.bind(console);
const { chromium } = require('playwright');
const fs = require('fs');

const CDP_URL = 'http://localhost:19228';
const PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate';
const FORBIDDEN_API_PATTERNS = [
  '/cgi-bin/mmfinderassistant-bin/post',
  '/cgi-bin/mmfinder-bin/feed/postnewlife',
];

async function main(queueFilePath) {
  _log('[SPH-DRY] 读取队列文件:', queueFilePath);
  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  const title = queueData.title || `[DRY] 自检 ${Date.now()}`;
  const content = queueData.content || '';
  const localImages = (queueData.images || []).filter((f) => fs.existsSync(f));

  _log('[SPH-DRY] 标题:', title);
  _log('[SPH-DRY] 文案:', content.substring(0, 50));
  _log('[SPH-DRY] 图片(本地):', localImages.length, '张');

  _log('[SPH-DRY] 连接到现有浏览器:', CDP_URL);
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('CDP 没有上下文，确认 Chrome 19228 是否登录视频号');
  const context = contexts[0];
  const pages = context.pages();
  if (!pages.length) throw new Error('CDP 没有 page');
  const page = pages[0];
  _log('[SPH-DRY] 已连接到浏览器');

  let forbiddenApiHit = null;
  page.on('request', (req) => {
    const u = req.url();
    for (const pat of FORBIDDEN_API_PATTERNS) {
      if (u.includes(pat) && (req.method() === 'POST' || req.method() === 'PUT')) {
        forbiddenApiHit = `${req.method()} ${u}`;
        _log('[SPH-DRY] !! 检测到疑似发布 API !!', forbiddenApiHit);
      }
    }
  });

  try {
    _log('[SPH-DRY] Step 1: 导航到发布页');
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('cgi-bin/loginpage')) {
      throw new Error(`视频号未登录，当前 URL: ${url1}`);
    }

    _log('[SPH-DRY] Step 2: 验证页面已就位（不操作 DOM）');
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    _log('[SPH-DRY] 当前 URL:', finalUrl);

    if (forbiddenApiHit) {
      throw new Error(`dry-run 失守：检测到 ${forbiddenApiHit}`);
    }

    const result = {
      ok: true,
      dryRun: true,
      url: finalUrl,
      title,
      imagesCount: localImages.length,
    };
    _log(JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('[SPH-DRY] 失败:', err.message);
    throw err;
  }
}

const queueFilePath = process.argv[2];
if (!queueFilePath) {
  console.error('用法: node publish-shipinhao-image-dryrun.cjs <queue-file-path>');
  process.exit(1);
}

main(queueFilePath)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
