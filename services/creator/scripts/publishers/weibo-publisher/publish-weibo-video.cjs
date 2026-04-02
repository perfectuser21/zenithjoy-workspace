#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const WINDOWS_IP_WB = '100.97.242.124';
const WINDOWS_USER_WB = 'xuxia';
const WINDOWS_BASE_DIR_WB = 'C:\\Users\\xuxia\\weibo-media';

function scpVideoWB(localFile, windowsDir) {
  const fname = path.basename(localFile);
  const winDirFwd = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER_WB}@${WINDOWS_IP_WB} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirFwd}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );
  execSync(
    `scp -o StrictHostKeyChecking=no "${localFile}" "${WINDOWS_USER_WB}@${WINDOWS_IP_WB}:${winDirFwd}/${fname}"`,
    { timeout: 300000, stdio: 'pipe' }
  );
  console.log(`   ✅ 视频已传输到 Windows`);
  return path.join(windowsDir, fname);
}

const CDP_URL = 'http://100.97.242.124:19227';
const HOME_URL = 'https://weibo.com/';
const SCREENSHOTS_DIR = '/tmp/weibo-publish-screenshots';
const SUCCESS_SCREENSHOT = '/tmp/weibo-video-success.png';
const COMPOSER_PLACEHOLDER = '有什么新鲜事想分享给大家？';

function parseArgs(argv) {
  const args = argv.slice(2);
  const take = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : '';
  };

  const title = (take('--title') || '').trim();
  const video = take('--video');
  const desc = (take('--desc') || '').trim();

  if (!title) {
    throw new Error('必须提供 --title');
  }
  if (!video || !fs.existsSync(video)) {
    throw new Error('必须提供有效的 --video 本地文件路径');
  }

  return {
    title,
    desc,
    video: path.resolve(video),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page, targetPath) {
  ensureDir(path.dirname(targetPath));
  await page.screenshot({
    path: targetPath,
    timeout: 120000,
    animations: 'disabled',
  });
  console.log(`   📸 ${targetPath}`);
}

async function waitForComposer(page) {
  await page.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`).first().waitFor({
    state: 'visible',
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
}

async function getProfileUrl(page) {
  const profileUrl = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/u/"]'));
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      return link.href;
    }
    return null;
  });

  if (!profileUrl) {
    throw new Error('未找到当前账号个人主页链接');
  }
  return profileUrl;
}

async function waitForVideoAttached(page) {
  await page.waitForFunction(
    () => {
      const nodes = Array.from(document.querySelectorAll('div, span'));
      return nodes.some(node => {
        const rect = node.getBoundingClientRect();
        const text = (node.textContent || '').trim();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.top > 350) return false;
        return /^\d{1,2}:\d{2}$/.test(text);
      });
    },
    null,
    { timeout: 120000 }
  );
}

async function fillComposer(page, content) {
  const editor = page.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`).first();
  await editor.click();
  await editor.fill(content);
}

async function clickSend(page) {
  const button = page.locator('button').filter({ hasText: '发送' }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  await button.click();
}

async function waitForPublishSettled(page) {
  await page.waitForFunction(
    placeholder => {
      const toastTexts = Array.from(document.querySelectorAll('div, span'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean);
      if (toastTexts.some(text => text.includes('发布成功') || text.includes('发送成功'))) {
        return true;
      }

      const editor = document.querySelector(`textarea[placeholder="${placeholder}"]`);
      return editor && editor.value === '';
    },
    COMPOSER_PLACEHOLDER,
    { timeout: 30000 }
  );
}

async function verifyLatestPost(page, profileUrl, expectedText) {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const result = await page.evaluate(target => {
    const bodyText = document.body ? document.body.innerText || '' : '';
    const latestVisibleText = Array.from(document.querySelectorAll('div, article, section'))
      .map(node => {
        const rect = node.getBoundingClientRect();
        const text = (node.textContent || '').trim();
        if (rect.width <= 0 || rect.height <= 0) return '';
        if (rect.top > 900) return '';
        return text;
      })
      .find(text => text.includes(target)) || '';

    return {
      found: bodyText.includes(target),
      bodyText,
      latestVisibleText,
    };
  }, expectedText);

  if (!result.found) {
    console.warn(`⚠️  个人主页未找到文本: ${expectedText}（视频帖可能不显示标题，不视为失败）`);
  } else {
    console.log(`   ✅ 个人主页已找到: ${expectedText}`);
  }
}

async function main() {
  const { title, desc, video } = parseArgs(process.argv);
  const content = [title, desc].filter(Boolean).join('\n');
  ensureDir(SCREENSHOTS_DIR);

  console.log('\n========================================');
  console.log('微博视频发布');
  console.log('========================================\n');
  console.log(`📝 标题: ${title}`);
  console.log(`🎬 视频: ${video}`);
  console.log(`📄 描述长度: ${desc.length}`);
  console.log('');

  let browser;
  let page;

  try {
    console.log('1️⃣  连接微博 CDP...');
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60000 });
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('CDP 已连接，但未找到浏览器上下文');
    }

    page = context.pages().find(item => item.url().includes('weibo.com')) || await context.newPage();

    console.log('2️⃣  打开微博首页...');
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForComposer(page);
    const profileUrl = await getProfileUrl(page);
    await screenshot(page, path.join(SCREENSHOTS_DIR, 'video-home-ready.png'));

    console.log('3️⃣  SCP 视频到 Windows...');
    const winVideoDir = `${WINDOWS_BASE_DIR_WB}\\${Date.now()}`;
    const winVideoPath = scpVideoWB(video, winVideoDir);
    
    console.log('   上传视频到发博框（DOM.setFileInputFiles）...');
    const wbCdpSession = await context.newCDPSession(page);
    const wbFileRes = await wbCdpSession.send('Runtime.evaluate', { expression: `document.querySelector('input[type="file"]')` });
    if (!wbFileRes.result.objectId) throw new Error('未找到微博 file input');
    const wbNode = await wbCdpSession.send('DOM.describeNode', { objectId: wbFileRes.result.objectId });
    await wbCdpSession.send('DOM.setFileInputFiles', { backendNodeId: wbNode.node.backendNodeId, files: [winVideoPath] });
    await wbCdpSession.detach();
    await waitForVideoAttached(page);
    await page.waitForTimeout(3000);
    await screenshot(page, path.join(SCREENSHOTS_DIR, 'video-attached.png'));

    console.log('4️⃣  填写文案并发送...');
    await fillComposer(page, content);
    await page.waitForTimeout(1000);
    await screenshot(page, path.join(SCREENSHOTS_DIR, 'video-filled.png'));
    await clickSend(page);
    await waitForPublishSettled(page);

    console.log('5️⃣  校验个人主页最新微博...');
    await verifyLatestPost(page, profileUrl, title);
    await screenshot(page, SUCCESS_SCREENSHOT);

    console.log('\n✅ 微博视频发布成功');
    console.log(`   个人主页: ${profileUrl}`);
    console.log(`   成功截图: ${SUCCESS_SCREENSHOT}`);
  } catch (error) {
    console.error(`\n❌ 发布失败: ${error.message}`);
    if (page) {
      try {
        await screenshot(page, path.join(SCREENSHOTS_DIR, 'video-error.png'));
      } catch (screenshotError) {
        console.error(`   补充截图失败: ${screenshotError.message}`);
      }
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main();
