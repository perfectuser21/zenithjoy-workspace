#!/usr/bin/env node
'use strict';

/**
 * 微博长文章发布脚本
 *
 * 技术方案：Playwright CDP 连接 Windows Chrome → 操作 weibo.com/ttarticle/editor
 *
 * 发布流程：
 *   1. Playwright CDP 连接 Windows Chrome（100.97.242.124:19227）
 *   2. 导航到 https://weibo.com/ttarticle/editor（新建文章页）
 *   3. 等待编辑器加载（标题输入框出现）
 *   4. 填写标题
 *   5. 填写正文（contenteditable 富文本区域）
 *   6. 可选：上传封面图（通过 DOM.setFileInputFiles）
 *   7. 点击"发布"按钮
 *   8. 等待发布成功（URL 变化 → 文章详情页）
 *   9. 打印文章链接并退出
 *
 * 用法：
 *   node publish-weibo-article.cjs --title "文章标题" --content /path/to/content/
 *
 * 内容目录结构：
 *   content.txt   - 正文内容（必须）
 *   cover.jpg     - 封面图（可选，支持 cover.png、cover.webp）
 *
 * 参数说明：
 *   --title <标题>         文章标题（必填）
 *   --content <目录路径>   内容目录（必填，含 content.txt）
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// ============================================================
// 配置
// ============================================================

const CDP_URL = 'http://100.97.242.124:19227';
const ARTICLE_EDITOR_URL = 'https://www.weibo.com/ttarticle/editor';
const SCREENSHOTS_DIR = '/tmp/weibo-article-screenshots';
const SUCCESS_SCREENSHOT = '/tmp/weibo-article-success.png';

// 封面图支持的扩展名
const COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const COVER_NAMES = ['cover', 'thumbnail', 'image'];

// ============================================================
// 参数解析
// ============================================================

function parseArgs(argv) {
  const args = argv.slice(2);
  const take = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : '';
  };

  const title = (take('--title') || '').trim();
  const contentDir = take('--content');

  if (!title) {
    throw new Error('必须提供 --title <文章标题>');
  }
  if (!contentDir || !fs.existsSync(contentDir)) {
    throw new Error('必须提供有效的 --content <内容目录路径>');
  }

  return {
    title,
    contentDir: path.resolve(contentDir),
  };
}

// ============================================================
// 工具函数
// ============================================================

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 读取内容目录中的正文文本
 *
 * @param {string} contentDir - 内容目录路径
 * @returns {string} 正文内容
 */
function readBodyText(contentDir) {
  const contentFile = path.join(contentDir, 'content.txt');
  if (!fs.existsSync(contentFile)) {
    return '';
  }
  return fs.readFileSync(contentFile, 'utf8').trim();
}

/**
 * 查找内容目录中的封面图
 *
 * @param {string} contentDir - 内容目录路径
 * @returns {string|null} 封面图绝对路径，无则返回 null
 */
function findCoverImage(contentDir) {
  const files = fs.readdirSync(contentDir);
  for (const file of files) {
    const base = path.basename(file, path.extname(file)).toLowerCase();
    const ext = path.extname(file).toLowerCase();
    if (COVER_NAMES.includes(base) && COVER_EXTS.includes(ext)) {
      return path.join(contentDir, file);
    }
  }
  return null;
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

// ============================================================
// 主流程
// ============================================================

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(`❌ 错误：${err.message}`);
    console.error('使用方式：node publish-weibo-article.cjs --title <标题> --content <内容目录>');
    process.exit(1);
  }

  const { title, contentDir } = args;
  const bodyText = readBodyText(contentDir);
  const coverImage = findCoverImage(contentDir);

  console.log('\n========================================');
  console.log('微博长文章发布');
  console.log('========================================\n');
  console.log(`📝 标题: ${title}`);
  console.log(`📄 正文长度: ${bodyText.length} 字符`);
  console.log(`🖼️  封面图: ${coverImage ? path.basename(coverImage) : '无'}`);
  console.log('');

  ensureDir(SCREENSHOTS_DIR);

  let browser;
  let page;

  try {
    // ===== 步骤1: CDP 连接 =====
    console.log('1️⃣  连接微博 CDP...');
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60000 });
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('CDP 已连接，但未找到浏览器上下文');
    }

    // 优先复用已有微博页面，否则新建
    page =
      context.pages().find(p => p.url().includes('weibo.com')) ||
      (await context.newPage());

    console.log('   ✅ CDP 已连接\n');

    // ===== 步骤2: 导航到文章编辑器 =====
    console.log('2️⃣  打开微博文章编辑器...');
    await page.goto(ARTICLE_EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await screenshot(page, path.join(SCREENSHOTS_DIR, 'article-editor-loaded.png'));
    console.log(`   ✅ 已导航到 ${page.url()}\n`);

    // 检查是否被重定向到登录页
    if (
      page.url().includes('passport.weibo.com') ||
      page.url().includes('/login') ||
      page.url().includes('/signin')
    ) {
      throw new Error('会话失效：被重定向到登录页，请在 Windows Chrome (19227) 重新登录微博');
    }

    // ===== 步骤3: 等待并填写标题 =====
    console.log('3️⃣  填写文章标题...');

    // 等待标题输入框出现（ttarticle 编辑器结构）
    const titleSelector = 'input[placeholder*="标题"], input[class*="title"], textarea[class*="title"], div[class*="title"][contenteditable="true"]';
    try {
      await page.waitForSelector(titleSelector, { state: 'visible', timeout: 30000 });
    } catch {
      // 尝试更通用的选择器
      await page.waitForSelector('input[type="text"]', { state: 'visible', timeout: 30000 });
    }

    // 获取标题输入框并填写
    const titleInput = await page.$(titleSelector) || await page.$('input[type="text"]');
    if (!titleInput) {
      throw new Error('未找到标题输入框，编辑器可能未正确加载');
    }

    await titleInput.click();
    await titleInput.fill(title);
    await page.waitForTimeout(500);
    console.log(`   ✅ 标题已填写: ${title}\n`);

    // ===== 步骤4: 填写正文 =====
    if (bodyText) {
      console.log('4️⃣  填写文章正文...');

      // ttarticle 编辑器正文区域为 contenteditable div
      const bodySelector =
        'div[contenteditable="true"]:not([class*="title"]), ' +
        '.ql-editor, ' +
        'div[class*="editor"], ' +
        'div[class*="content"][contenteditable="true"]';

      const bodyEl = await page.$(bodySelector);
      if (!bodyEl) {
        throw new Error('未找到正文编辑区域，编辑器可能未正确加载');
      }

      await bodyEl.click();
      await page.waitForTimeout(300);

      // 对于 contenteditable，使用 fill 或 keyboard.type
      await bodyEl.fill(bodyText).catch(async () => {
        // fill 不支持 contenteditable，改用 keyboard 输入
        await page.keyboard.type(bodyText, { delay: 5 });
      });

      await page.waitForTimeout(500);
      console.log(`   ✅ 正文已填写（${bodyText.length} 字符）\n`);
    } else {
      console.log('4️⃣  正文为空，跳过\n');
    }

    // ===== 步骤5: 上传封面图（可选）=====
    if (coverImage) {
      console.log('5️⃣  上传封面图...');

      // 通过 CDP Session 的 DOM.setFileInputFiles 上传（与 video.cjs 相同方案）
      const cdpSession = await context.newCDPSession(page);
      try {
        const fileInputRes = await cdpSession.send('Runtime.evaluate', {
          expression: `document.querySelector('input[type="file"]')`,
        });

        if (fileInputRes.result.objectId) {
          const nodeRes = await cdpSession.send('DOM.describeNode', {
            objectId: fileInputRes.result.objectId,
          });
          await cdpSession.send('DOM.setFileInputFiles', {
            backendNodeId: nodeRes.node.backendNodeId,
            files: [coverImage],
          });
          await page.waitForTimeout(3000);
          await screenshot(page, path.join(SCREENSHOTS_DIR, 'article-cover-uploaded.png'));
          console.log(`   ✅ 封面图已上传: ${path.basename(coverImage)}\n`);
        } else {
          console.warn('   ⚠️  未找到 file input，跳过封面图上传\n');
        }
      } finally {
        await cdpSession.detach();
      }
    }

    // ===== 步骤6: 截图确认 =====
    await screenshot(page, path.join(SCREENSHOTS_DIR, 'article-before-publish.png'));

    // ===== 步骤7: 点击发布 =====
    console.log('6️⃣  点击发布按钮...');

    const publishButtonSelector =
      'button:has-text("发布"), ' +
      'button:has-text("发表"), ' +
      'span:has-text("发布"), ' +
      'a:has-text("发布文章")';

    const publishBtn = await page.$(publishButtonSelector);
    if (!publishBtn) {
      throw new Error('未找到发布按钮，请检查编辑器页面状态');
    }

    await publishBtn.waitForElementState('visible', { timeout: 10000 });
    await publishBtn.click();
    console.log('   ✅ 已点击发布按钮\n');

    // ===== 步骤8: 等待发布成功 =====
    console.log('7️⃣  等待发布成功...');

    // 等待 URL 变化（从 editor 页跳转到文章详情页）
    // 文章详情页 URL 格式：weibo.com/ttarticle/p/show?id=xxxxx 或 weibo.com/ttarticle/xxx
    let articleUrl = null;

    try {
      await page.waitForURL(url => url.includes('ttarticle') && !url.includes('editor'), {
        timeout: 60000,
      });
      articleUrl = page.url();
    } catch {
      // URL 未变化，尝试通过 DOM 检测成功提示
      try {
        await page.waitForFunction(
          () => {
            const texts = Array.from(document.querySelectorAll('div, span, p'))
              .map(el => el.textContent.trim())
              .filter(Boolean);
            return texts.some(t => t.includes('发布成功') || t.includes('发表成功') || t.includes('文章已发布'));
          },
          { timeout: 30000 }
        );
        articleUrl = page.url();
      } catch {
        // 尝试通过当前 URL 判断
        const currentUrl = page.url();
        if (currentUrl.includes('ttarticle') && !currentUrl.includes('editor')) {
          articleUrl = currentUrl;
        } else {
          throw new Error('发布超时：未检测到成功跳转或成功提示，请检查截图');
        }
      }
    }

    await page.waitForTimeout(2000);
    await screenshot(page, SUCCESS_SCREENSHOT);

    console.log('\n✅ 微博文章发布成功！');
    if (articleUrl) {
      console.log(`   文章链接: ${articleUrl}`);
    }
    console.log(`   成功截图: ${SUCCESS_SCREENSHOT}`);
  } catch (error) {
    console.error(`\n❌ 发布失败: ${error.message}`);
    if (page) {
      try {
        await screenshot(page, path.join(SCREENSHOTS_DIR, 'article-error.png'));
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
