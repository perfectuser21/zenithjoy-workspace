const _log = console.log.bind(console);
#!/usr/bin/env node
/**
 * 微博图文发布脚本
 *
 * 功能：发布图文内容（文字 + 图片），内置验证码自动处理
 * 用法：node publish-weibo-image.cjs --content /path/to/image-{id}/
 *
 * 内容目录结构：
 *   content.txt   - 文案内容（可选，支持话题 #xxx#）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { CDPClient } = require('./cdp-client.cjs');
const {
  PUBLISH_URL,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
  withRetry,
} = require('./utils.cjs');

const CDP_PORT = 19227;
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const SCREENSHOTS_DIR = '/tmp/weibo-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\weibo-media';
const MAX_IMAGES = 9; // 微博平台最多 9 张图片

// 验证码相关选择器（微博使用天鉴/GeeTest 验证）
const CAPTCHA_SELECTORS = [
  '[class*="geetest"]',
  '[class*="tc-9bad"]',
  '[class*="captcha"]',
  '[class*="验证"]',
  '.tc-action-slide',
  '.geetest_holder',
  '.geetest_wrap',
];

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 命令行参数解析
const args = process.argv.slice(2);
const contentDirArg = args[args.indexOf('--content') + 1];

if (!contentDirArg || !fs.existsSync(contentDirArg)) {
  console.error('❌ 错误：必须提供有效的内容目录路径');
  console.error('使用方式：node publish-weibo-image.cjs --content /path/to/image-xxx/');
  process.exit(1);
}

const contentDir = path.resolve(contentDirArg);

// 读取内容
const contentText = readContent(contentDir);

const allImages = findImages(contentDir);
if (allImages.length === 0) {
  console.error('❌ 错误：内容目录中没有图片文件');
  process.exit(1);
}

// 微博平台限制：最多 9 张图片
const localImages = allImages.length > MAX_IMAGES
  ? allImages.slice(0, MAX_IMAGES)
  : allImages;
if (allImages.length > MAX_IMAGES) {
  console.warn(`⚠️  图片数量 ${allImages.length} 超过微博限制 ${MAX_IMAGES} 张，已截断为前 ${MAX_IMAGES} 张`);
}

// 转换图片路径为 Windows 绝对路径
const { dateDir, contentDirName } = extractDirNames(contentDir);
const windowsImages = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, dateDir, contentDirName);

_log('\n========================================');
_log('微博图文发布');
_log('========================================\n');
_log(`📁 内容目录: ${contentDir}`);
_log(`📝 文案长度: ${contentText.length} 字符`);
_log(`🖼️  图片数量: ${localImages.length}${allImages.length > MAX_IMAGES ? ` (截断自 ${allImages.length})` : ''}`);
if (windowsImages.length > 0) {
  _log(`📁 Windows 路径: ${windowsImages[0]}`);
}
_log('');

// CDP 客户端
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    _log(`   📸 ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`   ❌ 截图失败: ${e.message}`);
    return null;
  }
}

/**
 * 验证码处理模块
 *
 * 检测并自动处理微博滑块验证码：
 * 1. 检测验证码是否存在
 * 2. 截图保存用于调试
 * 3. 模拟人手拖动滑块（含加速度曲线）
 */
async function handleCaptcha(cdp) {
  _log('   🔍 检测验证码...\n');

  // 检测验证码是否存在
  const captchaCheck = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const selectors = ${JSON.stringify(CAPTCHA_SELECTORS)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          const rect = el.getBoundingClientRect();
          return {
            found: true,
            selector: sel,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        }
      }
      return { found: false };
    })()`,
    returnByValue: true
  });

  const captchaResult = captchaCheck.result.value;
  if (!captchaResult || !captchaResult.found) {
    _log('   ✅ 未检测到验证码\n');
    return true;
  }

  _log(`   ⚠️  检测到验证码: ${captchaResult.selector}`);
  await screenshot(cdp, 'captcha-detected');

  // 查找滑块元素
  const sliderCheck = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const sliderSelectors = [
        '.geetest_slider_button',
        '.tc-action-slide-text',
        '[class*="slide-btn"]',
        '[class*="slider"]',
        '.geetest_btn',
        '[class*="drag"]'
      ];
      for (const sel of sliderSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0) {
          const rect = el.getBoundingClientRect();
          return {
            found: true,
            selector: sel,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        }
      }
      // 在验证码容器内查找最可能是滑块的元素
      const containers = document.querySelectorAll(${JSON.stringify(CAPTCHA_SELECTORS.join(', '))});
      for (const container of containers) {
        if (!container.offsetWidth) continue;
        const rect = container.getBoundingClientRect();
        return {
          found: true,
          selector: 'container-fallback',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      }
      return { found: false };
    })()`,
    returnByValue: true
  });

  const sliderResult = sliderCheck.result.value;
  if (!sliderResult || !sliderResult.found) {
    _log('   ❌ 未找到滑块元素，无法自动处理验证码\n');
    await screenshot(cdp, 'captcha-no-slider');
    throw new Error('验证码出现但找不到滑块，需要手动处理');
  }

  _log(`   🎯 找到滑块: ${sliderResult.selector}`);

  // 计算滑块起始位置（中心点）
  const sliderRect = sliderResult.rect;
  const startX = sliderRect.x + sliderRect.width / 2;
  const startY = sliderRect.y + sliderRect.height / 2;

  // 目标距离：通常需要拖动验证码容器宽度的约 70-85%
  const captchaRect = captchaResult.rect;
  const dragDistance = captchaRect.width * 0.78;
  const endX = startX + dragDistance;
  const endY = startY;

  _log(`   🖱️  开始拖动: (${Math.round(startX)}, ${Math.round(startY)}) → (${Math.round(endX)}, ${Math.round(endY)})`);

  // 模拟人手拖动（含加速度曲线）
  await simulateDrag(cdp, startX, startY, endX, endY);

  // 等待验证结果
  await sleep(2000);
  await screenshot(cdp, 'captcha-after-drag');

  // 检查验证码是否消失
  const verifyCheck = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const selectors = ${JSON.stringify(CAPTCHA_SELECTORS)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          // 检查是否有成功状态
          const isSuccess = el.classList.toString().includes('success') ||
                           el.querySelector('[class*="success"]') !== null;
          return { stillVisible: true, isSuccess };
        }
      }
      return { stillVisible: false };
    })()`,
    returnByValue: true
  });

  const verifyResult = verifyCheck.result.value;
  if (!verifyResult.stillVisible || verifyResult.isSuccess) {
    _log('   ✅ 验证码处理成功\n');
    return true;
  }

  // 验证码仍然存在，重试一次（不同距离）
  _log('   ⚠️  验证码未消失，重试...\n');
  await sleep(1000);

  const retryDistance = captchaRect.width * 0.65;
  const retryEndX = startX + retryDistance;
  await simulateDrag(cdp, startX, startY, retryEndX, startY);
  await sleep(2000);
  await screenshot(cdp, 'captcha-retry');

  // 最终检查
  const finalCheck = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const selectors = ${JSON.stringify(CAPTCHA_SELECTORS)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0) return { stillVisible: true };
      }
      return { stillVisible: false };
    })()`,
    returnByValue: true
  });

  if (!finalCheck.result.value.stillVisible) {
    _log('   ✅ 重试后验证码处理成功\n');
    return true;
  }

  _log('   ❌ 验证码处理失败，截图已保存到 ' + SCREENSHOTS_DIR + '\n');
  throw new Error('验证码自动处理失败，请查看截图后手动处理');
}

/**
 * 模拟人手拖动（含加速度曲线）
 * 使用缓动函数模拟自然的加速-减速动作
 */
async function simulateDrag(cdp, fromX, fromY, toX, toY) {
  const steps = 30;
  const duration = 800; // 毫秒

  // 按下鼠标
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: fromX,
    y: fromY,
    button: 'left',
    clickCount: 1
  });

  // 模拟拖动路径（缓动函数：先快后慢）
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    // 使用 easeOutQuart 缓动：开始快，接近目标时减速
    const eased = 1 - Math.pow(1 - progress, 4);
    // 添加轻微的 Y 轴抖动模拟真实手势
    const yJitter = Math.sin(progress * Math.PI) * 2;

    const currentX = fromX + (toX - fromX) * eased;
    const currentY = fromY + (toY - fromY) * eased + yJitter;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: currentX,
      y: currentY,
      button: 'left'
    });

    // 步骤间隔（加速度曲线：前半段快，后半段慢）
    const delay = (duration / steps) * (0.5 + progress * 0.5);
    await sleep(delay);
  }

  // 释放鼠标
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: toX,
    y: toY,
    button: 'left',
    clickCount: 1
  });
}

function scpImagesToWindows(localImages, windowsDir) {
  if (!localImages.length) return;
  _log(`[WB] SCP 图片到 Windows（${localImages.length} 张）...`);
  const winDirFwd = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirFwd}' | Out-Null; Write-Host ok\\""`,
    { timeout: 25000, stdio: 'pipe' }
  );
  for (const img of localImages) {
    const fname = path.basename(img);
    execSync(
      `scp -o StrictHostKeyChecking=no "${img}" "${WINDOWS_USER}@${WINDOWS_IP}:${winDirFwd}/${fname}"`,
      { timeout: 180000, stdio: 'pipe' }
    );
    _log(`[WB]    已传输: ${fname}`);
  }
  _log(`[WB]    ✅ ${localImages.length} 张图片已到 Windows`);
}

async function main() {
  let cdp;

  try {
    // SCP 图片到 Windows
    if (localImages.length > 0) {
      const { dateDir: dDir, contentDirName: cdName } = extractDirNames(contentDir);
      const winDir = path.join(WINDOWS_BASE_DIR, dDir, cdName).replace(/\//g, '\\');
      scpImagesToWindows(localImages, winDir);
    }

    // 获取 CDP 连接（带重试，处理网络抖动）
    _log('🔌 连接 CDP...\n');
    const pagesData = await withRetry(
      () => new Promise((resolve, reject) => {
        http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`CDP 响应解析失败: ${e.message}`)); }
          });
        }).on('error', err => {
          reject(new Error(`CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}\n排查命令：curl http://${WINDOWS_IP}:${CDP_PORT}/json`));
        });
      }),
      3,
      2000
    );

    // 找到微博页面
    const weiboPage = pagesData.find(
      p => p.type === 'page' && p.url.includes('weibo.com')
    );
    if (!weiboPage) {
      const firstPage = pagesData.find(p => p.type === 'page');
      if (!firstPage) throw new Error('未找到任何浏览器页面');
      _log(`   ⚠️  未找到微博页面，使用: ${firstPage.url}`);
      cdp = new CDPClient(firstPage.webSocketDebuggerUrl);
    } else {
      cdp = new CDPClient(weiboPage.webSocketDebuggerUrl);
    }

    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    _log('✅ CDP 已连接\n');

    // ========== 步骤1: 导航到微博首页并打开发博框 ==========
    _log('1️⃣  导航到微博首页...\n');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await screenshot(cdp, '01-initial');

    // 检查当前 URL
    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    const currentUrl = urlResult.result.value;
    _log(`   当前 URL: ${currentUrl}\n`);

    if (!currentUrl.includes('weibo.com')) {
      throw new Error(`导航失败，当前页面: ${currentUrl}`);
    }

    // 使用 isLoginRedirect 检测登录跳转（覆盖所有登录页 URL 模式）
    if (isLoginRedirect(currentUrl)) {
      throw new Error('微博未登录，请在 Windows PC Chrome (19227) 上先登录微博账号');
    }

    // 使用 isPublishPageReached 验证成功到达发布页
    if (!isPublishPageReached(currentUrl)) {
      throw new Error(`未到达发布页，当前页面: ${currentUrl}，请检查账号状态`);
    }
    _log('   ✅ 已到达微博首页\n');

    // 点击"写微博"按钮打开发博框
    _log('   点击"写微博"按钮...\n');
    const writeResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.trim() === '写微博');
        if (btn) { btn.click(); return {clicked: true}; }
        return {clicked: false, btns: btns.map(b => b.textContent.trim()).filter(t => t).slice(0, 10)};
      })()`,
      returnByValue: true
    });
    _log(`   写微博按钮: ${JSON.stringify(writeResult.result.value)}`);
    await sleep(2000);

    // 检测验证码（导航后可能触发）
    await handleCaptcha(cdp);

    // ========== 步骤2: 填写文案 ==========
    if (contentText) {
      _log('2️⃣  填写文案...\n');

      const escapedContent = escapeForJS(contentText);

      const fillResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            'textarea[placeholder*="新鲜事"]',
            'textarea[placeholder*="想说什么"]',
            'textarea[placeholder*="分享"]',
            'textarea[placeholder*="内容"]',
            'textarea[placeholder*="输入"]',
            'textarea._input_2ho67_8',
            'div[contenteditable="true"][class*="post"]',
            'div[contenteditable="true"][class*="editor"]',
            'div[contenteditable="true"]',
            '.ql-editor',
            'textarea'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.focus();
              if (el.tagName === 'TEXTAREA') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(el, '${escapedContent}');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                el.innerText = '${escapedContent}';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return { success: true, selector: sel };
            }
          }
          return { success: false, error: '未找到文案输入区域' };
        })()`,
        returnByValue: true
      });

      const fillVal = fillResult.result.value;
      _log(`   填写结果: ${JSON.stringify(fillVal)}`);
      await sleep(1000);
      await screenshot(cdp, '02-content-filled');

      if (fillVal && fillVal.success) {
        _log(`   ✅ 已填写 ${contentText.length} 字\n`);
      } else {
        _log('   ⚠️  文案填写可能未成功，继续上传图片...\n');
      }
    } else {
      _log('2️⃣  跳过文案（无文案内容）\n');
    }

    // ========== 步骤3: 上传图片 ==========
    _log(`3️⃣  上传图片（${windowsImages.length} 张）...\n`);

    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    _log(`   找到 ${nodeIds.length} 个 file input\n`);

    if (nodeIds.length === 0) {
      // 尝试点击图片上传按钮
      _log('   尝试点击图片上传按钮...\n');
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            '[class*="pic-add"]',
            '[class*="image-add"]',
            '[class*="upload"]',
            '.woo-icon-camera',
            'label[class*="upload"]'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.click();
              return { clicked: true, selector: sel };
            }
          }
          const buttons = Array.from(document.querySelectorAll('button, label, div[role="button"]'));
          const uploadBtn = buttons.find(b =>
            b.textContent && (b.textContent.includes('图片') || b.textContent.includes('添加')) &&
            b.offsetWidth > 0
          );
          if (uploadBtn) {
            uploadBtn.click();
            return { clicked: true, text: uploadBtn.textContent.trim() };
          }
          return { clicked: false };
        })()`
      });
      await sleep(2000);

      // 再次查找 file input
      const { root: root2 } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeIds: nodeIds2 } = await cdp.send('DOM.querySelectorAll', {
        nodeId: root2.nodeId,
        selector: 'input[type="file"]'
      });
      nodeIds.push(...nodeIds2);
    }

    if (nodeIds.length > 0) {
      _log('   设置图片文件...\n');
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: nodeIds[0],
        files: windowsImages
      });

      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const inputs = document.querySelectorAll('input[type="file"]');
          if (inputs[0]) {
            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`
      });

      await sleep(6000);
      await screenshot(cdp, '03-images-uploaded');
      _log('   ✅ 图片已上传\n');
    } else {
      _log('   ❌ 未找到文件上传输入框\n');
      await screenshot(cdp, '03-no-file-input');
    }

    // ========== 步骤4: 检测并处理验证码 ==========
    _log('4️⃣  检测验证码...\n');
    try {
      await handleCaptcha(cdp);
    } catch (captchaErr) {
      console.error(`   ❌ 验证码处理失败: ${captchaErr.message}`);
      await screenshot(cdp, '04-captcha-failed');
      throw captchaErr;
    }

    // ========== 步骤5: 发布 ==========
    _log('5️⃣  点击发布...\n');

    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'));
        const publishBtn = buttons.find(b =>
          b.textContent && (b.textContent.trim() === '发布' || b.textContent.trim() === '发送' || b.textContent.includes('发布微博')) &&
          b.offsetWidth > 0 &&
          !b.disabled
        );
        if (publishBtn) {
          publishBtn.click();
          return { clicked: true, text: publishBtn.textContent.trim() };
        }
        // 备选：查找 .woo-button 类型的发布按钮
        const wooBtn = document.querySelector('.woo-button[type="submit"], .submit-btn, .btn-publish');
        if (wooBtn && wooBtn.offsetWidth > 0 && !wooBtn.disabled) {
          wooBtn.click();
          return { clicked: true, selector: '.woo-button' };
        }
        return { clicked: false, error: '未找到发布按钮' };
      })()`,
      returnByValue: true
    });

    _log(`   发布按钮: ${JSON.stringify(publishResult.result.value)}`);
    await sleep(3000);
    await screenshot(cdp, '05-publish-clicked');

    // 检测发布后可能出现的验证码
    try {
      await handleCaptcha(cdp);
    } catch (captchaErr) {
      console.error(`   ❌ 发布后验证码处理失败: ${captchaErr.message}`);
      throw captchaErr;
    }

    // 处理可能的确认弹窗
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const confirmBtn = buttons.find(b =>
          b.textContent && (b.textContent.includes('确认') || b.textContent.includes('确定')) &&
          b.offsetWidth > 0 &&
          !b.disabled
        );
        if (confirmBtn) {
          confirmBtn.click();
          return { confirmed: true };
        }
        return { confirmed: false };
      })()`
    });

    await sleep(3000);

    // ========== 步骤6: 验证结果 ==========
    _log('6️⃣  验证发布结果...\n');

    const finalUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    const finalUrlValue = finalUrl.result.value;
    _log(`   最终 URL: ${finalUrlValue}\n`);

    await screenshot(cdp, '06-final');

    // 检查是否有成功提示
    const successCheck = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const body = document.body.textContent || '';
        return {
          hasSuccess: body.includes('发布成功') || body.includes('发表成功') || body.includes('微博已发布'),
          hasError: body.includes('发布失败') || body.includes('发表失败') || body.includes('错误'),
          urlChanged: !window.location.href.includes('/publish/')
        };
      })()`,
      returnByValue: true
    });

    const successVal = successCheck.result.value;
    _log(`   结果检查: ${JSON.stringify(successVal)}`);

    // 检测限频（微博对高频发帖的限制）
    const rateLimitResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const body = document.body.textContent || '';
        return body.includes('发帖太频繁') || body.includes('操作太频繁') ||
               body.includes('频率限制') || body.includes('限制发言') ||
               body.includes('操作过于频繁');
      })()`,
      returnByValue: true
    });
    if (rateLimitResult.result.value) {
      await screenshot(cdp, '06-rate-limited');
      throw new Error('微博限频：发帖太频繁，请等待后重试');
    }

    // 提取微博发布信息（ID 和链接）
    const postInfoResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const url = window.location.href;
        const match = url.match(/weibo\\.com\\/(?:detail\\/)?([A-Za-z0-9]{10,})/);
        return { postUrl: url, weiboId: match ? match[1] : null };
      })()`,
      returnByValue: true
    });
    const { postUrl, weiboId } = postInfoResult.result.value;

    if (successVal.hasSuccess || successVal.urlChanged) {
      _log('\n✅ 微博发布成功！');
      if (weiboId) _log(`   微博 ID: ${weiboId}`);
      if (postUrl && !postUrl.includes('/p/publish')) _log(`   链接: ${postUrl}`);
      _log(`   截图目录: ${SCREENSHOTS_DIR}`);
    } else if (successVal.hasError) {
      throw new Error('发布失败，请查看截图了解详情');
    } else {
      _log('\n⚠️  发布状态不确定，请查看截图确认');
      _log(`   截图目录: ${SCREENSHOTS_DIR}`);
    }

  } catch (err) {
    console.error(`\n❌ 发布失败: ${err.message}`);
    if (cdp) {
      await screenshot(cdp, 'error-final').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (cdp) cdp.close();
  }
}

main();
