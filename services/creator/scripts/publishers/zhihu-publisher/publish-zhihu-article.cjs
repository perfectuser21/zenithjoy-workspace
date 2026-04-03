#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 知乎专栏文章发布脚本
 *
 * 技术方案：CDP 控制 Windows PC Chrome 自动化发布
 *
 * 发布流程：
 *   1. CDP 连接 Windows Chrome (19229)
 *   2. 导航到 https://zhuanlan.zhihu.com/write
 *   3. 填写标题 + 正文（draft-js 富文本编辑器）
 *   4. 上传封面图（可选）
 *   5. 点击发布
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-zhihu-article.cjs --content /path/to/article-1/
 *
 * --dry-run 模式（不实际连接 CDP，仅打印参数）：
 *   node publish-zhihu-article.cjs --content /path/to/article-1/ --dry-run
 *
 * 内容目录结构：
 *   title.txt    - 标题（必需，100字以内）
 *   content.txt  - 正文（必需，纯文本或 HTML）
 *   cover.jpg    - 封面图（可选，支持 .jpg/.jpeg/.png）
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { CDPClient } = require('../weibo-publisher/cdp-client.cjs');
const { escapeForJS, withRetry } = require('../weibo-publisher/utils.cjs');

// ============================================================
// 配置
// ============================================================

const CDP_PORT = 19230;
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\zhihu-media';
const PUBLISH_URL = 'https://zhuanlan.zhihu.com/write';
const SCREENSHOTS_DIR = '/tmp/zhihu-publish-screenshots';
const ZHIHU_DOMAIN = 'zhuanlan.zhihu.com';

// ============================================================
// 纯工具函数（可单元测试）
// ============================================================

/**
 * 检测是否为知乎登录失效（跳转到登录页）
 *
 * @param {string} url - 当前页面 URL
 * @returns {boolean}
 */
function isLoginError(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('zhihu.com/signin') ||
    url.includes('zhihu.com/signup') ||
    url.includes('passport.zhihu.com') ||
    url.includes('/login')
  );
}

/**
 * 检测发布是否成功（页面 URL 或内容变化判断）
 *
 * @param {string} url - 发布后的页面 URL
 * @param {string} bodyText - 页面正文文本
 * @returns {boolean}
 */
function isPublishSuccess(url, bodyText) {
  if (!url || typeof url !== 'string') return false;
  // 发布成功后会跳转到文章页（如 /p/12345678）
  if (url.match(/zhuanlan\.zhihu\.com\/p\/\d+/)) return true;
  // 或页面提示"发布成功"
  if (bodyText && (bodyText.includes('发布成功') || bodyText.includes('文章已发布'))) return true;
  return false;
}

/**
 * 从内容目录读取封面图路径（支持 .jpg/.jpeg/.png）
 *
 * @param {string} contentDir - 内容目录
 * @param {object} [fsModule] - fs 注入（测试用）
 * @returns {string|null} 图片绝对路径，无则 null
 */
function findCoverImage(contentDir, fsModule) {
  const fsImpl = fsModule || fs;
  const candidates = ['cover.jpg', 'cover.jpeg', 'cover.png'];
  for (const name of candidates) {
    const p = path.join(contentDir, name);
    if (fsImpl.existsSync(p)) return p;
  }
  return null;
}

/**
 * 将本地封面图路径转换为 Windows 绝对路径
 *
 * @param {string} coverPath - 本地图片绝对路径（如 /Users/.../article-1/cover.jpg）
 * @param {string} windowsBaseDir - Windows 基础目录
 * @param {string} dateDir - 日期目录名（如 2026-03-10）
 * @param {string} contentDirName - 内容目录名（如 article-1）
 * @returns {string} Windows 路径（反斜杠）
 */
function toWindowsCoverPath(coverPath, windowsBaseDir, dateDir, contentDirName) {
  const filename = path.basename(coverPath);
  return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
}

// ============================================================
// 睡眠工具
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// CDP 操作工具
// ============================================================

/**
 * 截图并保存到 SCREENSHOTS_DIR
 */
async function screenshot(cdp, name) {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    _log(`[知乎]    📸 ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`[知乎]    截图失败: ${e.message}`);
    return null;
  }
}

/**
 * 连接 CDP 并获取知乎标签页
 */
async function connectCDP() {
  const pagesData = await withRetry(
    () =>
      new Promise((resolve, reject) => {
        http
          .get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`CDP 响应解析失败: ${e.message}`));
              }
            });
          })
          .on('error', err => {
            reject(
              new Error(
                `CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}\n` +
                  `排查：curl http://${WINDOWS_IP}:${CDP_PORT}/json\n` +
                  `确认 Chrome 以 --remote-debugging-port=${CDP_PORT} 启动`
              )
            );
          });
      }),
    3,
    2000
  );

  // 优先找知乎标签页
  const zhihuPage = pagesData.find(
    p => p.type === 'page' && p.url.includes(ZHIHU_DOMAIN)
  );
  const targetPage = zhihuPage || pagesData.find(p => p.type === 'page');

  if (!targetPage) {
    throw new Error(
      `未找到任何浏览器页面。\n请在 Chrome (端口 ${CDP_PORT}) 中打开 ${PUBLISH_URL}`
    );
  }

  if (!zhihuPage) {
    _log(`[知乎]    ⚠️  未找到知乎页面，使用当前页: ${targetPage.url}`);
  }

  const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  return cdp;
}

// ============================================================
// 主发布流程
// ============================================================

async function publishZhihuArticle({ title, content, coverPath, dryRun }) {
  if (dryRun) {
    _log('\n[知乎] [DRY-RUN] 参数验证通过，跳过实际发布');
    _log(`[知乎]   标题: ${title}`);
    _log(`[知乎]   正文长度: ${content.length} 字符`);
    _log(`[知乎]   封面: ${coverPath || '无'}`);
    return { success: true, dryRun: true };
  }

  let cdp;

  try {
    // ===== 步骤1: 连接 CDP =====
    _log('[知乎] 1️⃣  连接 CDP...\n');
    cdp = await connectCDP();
    _log('[知乎] ✅ CDP 已连接\n');

    // ===== 步骤2: 导航到发布页 =====
    _log('[知乎] 2️⃣  导航到知乎发布页...\n');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await screenshot(cdp, '01-initial');

    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const currentUrl = urlResult.result.value;
    _log(`[知乎]    当前 URL: ${currentUrl}\n`);

    if (isLoginError(currentUrl)) {
      throw new Error(
        `知乎未登录，请在 Chrome (端口 ${CDP_PORT}) 上先登录知乎\n` +
          `访问 ${PUBLISH_URL} 并完成登录`
      );
    }
    if (!currentUrl.includes(ZHIHU_DOMAIN)) {
      throw new Error(`导航失败，当前页面: ${currentUrl}，期望: ${PUBLISH_URL}`);
    }
    _log('[知乎]    ✅ 导航完成\n');

    // ===== 步骤3: 填写标题 =====
    _log(`[知乎] 3️⃣  填写标题: ${title}\n`);
    const escapedTitle = escapeForJS(title);

    const titleResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const selectors = [
          'input[placeholder*="标题"]',
          'input[placeholder*="请输入标题"]',
          'input.editor-titleinput',
          'input[class*="title"]',
          '.title-editor input',
          'textarea[placeholder*="标题"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0) {
            el.focus();
            const proto = el.tagName === 'INPUT'
              ? window.HTMLInputElement.prototype
              : window.HTMLTextAreaElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            nativeSetter.call(el, '${escapedTitle}');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, selector: sel };
          }
        }
        return { success: false, error: '未找到标题输入框' };
      })()`,
      returnByValue: true,
    });

    const titleRes = titleResult.result.value;
    _log(`[知乎]    标题填写: ${JSON.stringify(titleRes)}`);
    if (!titleRes || !titleRes.success) {
      await screenshot(cdp, '03-title-not-found');
      throw new Error(`标题输入框未找到: ${JSON.stringify(titleRes)}`);
    }
    await sleep(1000);
    await screenshot(cdp, '03-title-filled');

    // ===== 步骤4: 填写正文 =====
    _log(`[知乎] 4️⃣  填写正文（${content.length} 字符）...\n`);
    const escapedContent = escapeForJS(content);

    const contentResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        // 知乎使用 draft-js 富文本编辑器
        const selectors = [
          '.DraftEditor-root .public-DraftEditor-content',
          '.DraftEditor-editorContainer [contenteditable="true"]',
          '[contenteditable="true"][class*="editor"]',
          '.editor-content [contenteditable="true"]',
          '[contenteditable="true"]:not([class*="title"]):not([class*="header"])',
          '.ql-editor',
          'div[contenteditable="true"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0 && el.offsetHeight > 20) {
            el.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            document.execCommand('insertText', false, '${escapedContent}');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true, selector: sel };
          }
        }
        return { success: false, error: '未找到正文编辑器' };
      })()`,
      returnByValue: true,
    });

    const contentRes = contentResult.result.value;
    _log(`[知乎]    正文填写: ${JSON.stringify(contentRes)}`);
    if (!contentRes || !contentRes.success) {
      await screenshot(cdp, '04-editor-not-found');
      throw new Error(`正文编辑器未找到: ${JSON.stringify(contentRes)}`);
    }
    await sleep(2000);
    await screenshot(cdp, '04-content-filled');

    // ===== 步骤5: 上传封面图（可选）=====
    if (coverPath) {
      _log('[知乎] 5️⃣  上传封面图...\n');

      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            '[class*="cover"][class*="add"]',
            '[class*="add-cover"]',
            'span[class*="cover"]',
            '[class*="upload"][class*="cover"]'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.click();
              return { clicked: true, selector: sel };
            }
          }
          return { clicked: false };
        })()`,
      });
      await sleep(1000);

      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: 'input[type="file"]',
      });

      if (nodeIds.length > 0) {
        const dateDir = path.basename(path.dirname(coverPath));
        const contentDirName = path.basename(path.dirname(path.dirname(coverPath)));
        const winPath = toWindowsCoverPath(coverPath, WINDOWS_BASE_DIR, dateDir, contentDirName);

        await cdp.send('DOM.setFileInputFiles', {
          nodeId: nodeIds[0],
          files: [winPath],
        });
        await cdp.send('Runtime.evaluate', {
          expression: `document.querySelectorAll('input[type="file"]')[0]?.dispatchEvent(new Event('change', { bubbles: true }))`,
        });
        await sleep(3000);
        await screenshot(cdp, '05-cover-uploaded');
        _log('[知乎]    ✅ 封面图已上传\n');
      } else {
        _log('[知乎]    ⚠️  未找到文件上传 input，跳过封面图\n');
        await screenshot(cdp, '05-no-cover-input');
      }
    } else {
      _log('[知乎] 5️⃣  跳过封面图（无封面）\n');
    }

    // ===== 步骤6: 点击发布 =====
    _log('[知乎] 6️⃣  点击发布...\n');
    await sleep(2000);
    await screenshot(cdp, '06-before-publish');

    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));
        // 先精确匹配文字
        const publishBtn = buttons.find(b =>
          !b.disabled &&
          !b.classList.toString().includes('disabled') &&
          (b.innerText?.trim() === '发布' || b.innerText?.trim() === '发布文章' ||
           b.textContent.trim() === '发布' || b.textContent.trim() === '发布文章')
        );
        if (publishBtn) {
          publishBtn.click();
          return { clicked: true, text: publishBtn.innerText?.trim() };
        }
        // 通过 class 或 data 属性找
        const submitBtn = document.querySelector(
          'button[class*="publish"]:not([disabled]), button[class*="Publish"]:not([disabled]), button[class*="submit"]:not([disabled])'
        );
        if (submitBtn) {
          submitBtn.click();
          return { clicked: true, selector: 'submit-class' };
        }
        // 兜底：找包含"发布"但不含"设置"的按钮
        const fuzzyBtn = buttons.find(b =>
          (b.innerText || b.textContent || '').includes('发布') &&
          !(b.innerText || b.textContent || '').includes('设置')
        );
        if (fuzzyBtn) {
          fuzzyBtn.click();
          return { clicked: true, text: '(fuzzy)' + (fuzzyBtn.innerText?.trim() || '') };
        }
        return {
          clicked: false,
          error: '未找到发布按钮',
          btns: buttons.map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean).slice(0, 20)
        };
      })()`,
      returnByValue: true,
    });

    const publishRes = publishResult.result.value;
    _log(`[知乎]    发布按钮: ${JSON.stringify(publishRes)}`);

    if (!publishRes || !publishRes.clicked) {
      await screenshot(cdp, '06-publish-btn-not-found');
      throw new Error(`未能点击发布按钮: ${JSON.stringify(publishRes)}`);
    }

    // ===== 步骤7: 等待发布完成并验证 =====
    _log('[知乎] 7️⃣  等待发布完成...\n');
    await sleep(8000);
    await screenshot(cdp, '07-after-publish');

    const finalResult = await cdp.send('Runtime.evaluate', {
      expression: `({
        url: window.location.href,
        bodyText: (document.body.textContent || '').slice(0, 500)
      })`,
      returnByValue: true,
    });

    const { url: finalUrl, bodyText } = finalResult.result.value;
    _log(`[知乎]    最终 URL: ${finalUrl}\n`);

    const success = isPublishSuccess(finalUrl, bodyText);
    if (success) {
      _log('\n[知乎] ✅ 知乎文章发布成功！');
      _log(`[知乎]    文章链接: ${finalUrl}`);
      _log(`[知乎]    截图目录: ${SCREENSHOTS_DIR}`);
      return { success: true, url: finalUrl };
    } else {
      _log('\n[知乎] ⚠️  发布状态不确定，请查看截图确认');
      _log(`[知乎]    当前 URL: ${finalUrl}`);
      _log(`[知乎]    截图目录: ${SCREENSHOTS_DIR}`);
      return { success: false, url: finalUrl };
    }
  } finally {
    if (cdp) cdp.close();
  }
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    _log('用法：node publish-zhihu-article.cjs --content /path/to/article-1/');
    _log('');
    _log('选项：');
    _log('  --content <dir>   文章目录（必须包含 title.txt 和 content.txt）');
    _log('  --dry-run         仅验证参数，不实际发布');
    _log('  --help, -h        显示帮助');
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const contentIdx = args.indexOf('--content');
  const contentDirArg = contentIdx !== -1 ? args[contentIdx + 1] : null;

  if (!contentDirArg) {
    console.error('❌ 错误：必须提供 --content 参数');
    console.error('使用方式：node publish-zhihu-article.cjs --content /path/to/article-1/');
    process.exit(1);
  }

  if (!fs.existsSync(contentDirArg)) {
    console.error(`❌ 错误：内容目录不存在: ${contentDirArg}`);
    process.exit(1);
  }

  const contentDir = path.resolve(contentDirArg);

  // 读取标题
  const titleFile = path.join(contentDir, 'title.txt');
  if (!fs.existsSync(titleFile)) {
    console.error('❌ 错误：缺少 title.txt');
    process.exit(1);
  }
  const title = fs.readFileSync(titleFile, 'utf8').trim();
  if (!title) {
    console.error('❌ 错误：title.txt 内容为空');
    process.exit(1);
  }
  if (title.length > 100) {
    console.warn(`⚠️  标题超过 100 字 (${title.length})，建议缩短`);
  }

  // 读取正文
  const contentFile = path.join(contentDir, 'content.txt');
  if (!fs.existsSync(contentFile)) {
    console.error('❌ 错误：缺少 content.txt');
    process.exit(1);
  }
  const content = fs.readFileSync(contentFile, 'utf8').trim();
  if (!content) {
    console.error('❌ 错误：content.txt 内容为空');
    process.exit(1);
  }

  // 读取封面图（可选）
  const coverPath = findCoverImage(contentDir);

  _log('\n[知乎] ========================================');
  _log('[知乎] 知乎文章发布');
  _log('[知乎] ========================================\n');
  _log(`[知乎] 📁 内容目录: ${contentDir}`);
  _log(`[知乎] 📝 标题: ${title}`);
  _log(`[知乎] 📝 正文长度: ${content.length} 字符`);
  _log(`[知乎] 🖼️  封面: ${coverPath || '无'}`);
  if (dryRun) _log('[知乎] 🔍 DRY-RUN 模式\n');
  _log('');

  try {
    const result = await publishZhihuArticle({ title, content, coverPath, dryRun });
    if (!result.success && !result.dryRun) {
      process.exit(2);
    }
  } catch (err) {
    console.error(`\n[知乎] ❌ 发布失败: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// 导出纯函数供单元测试
module.exports = {
  isLoginError,
  isPublishSuccess,
  findCoverImage,
  toWindowsCoverPath,
};
