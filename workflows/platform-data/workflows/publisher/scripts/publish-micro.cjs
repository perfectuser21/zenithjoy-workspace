#!/usr/bin/env node
/**
 * 今日头条微头条发布脚本
 *
 * 功能：文字 + 图片发布
 * 用法：node publish-micro.cjs --content /path/to/micro-{id}.json
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';
const SCREENSHOTS_DIR = '/tmp/micro-publish-screenshots';

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 命令行参数解析
const args = process.argv.slice(2);
const contentFile = args[args.indexOf('--content') + 1];

if (!contentFile || !fs.existsSync(contentFile)) {
  console.error('❌ 错误：必须提供有效的内容文件路径');
  console.error('使用方式：node publish-micro.cjs --content /path/to/micro-xxx.json');
  process.exit(1);
}

// 读取内容
const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));

// 验证内容类型
if (content.type !== 'micro') {
  console.error('❌ 错误：此脚本只能发布微头条内容（type: micro）');
  process.exit(1);
}

if (!content.content || content.content.trim().length === 0) {
  console.error('❌ 错误：内容不能为空');
  process.exit(1);
}

// 转换图片路径为 Windows 绝对路径
const baseDir = 'C:\\Users\\Administrator\\Desktop\\toutiao-media';
const dateDir = path.dirname(contentFile).split('/').pop(); // 提取日期目录
const windowsImages = (content.images || []).map(img => {
  const filename = path.basename(img);
  return path.join(baseDir, dateDir, 'images', filename).replace(/\//g, '\\');
});

console.log('\n========================================');
console.log('今日头条微头条发布');
console.log('========================================\n');
console.log(`📄 内容 ID: ${content.id}`);
console.log(`📝 内容长度: ${content.content.length} 字符`);
console.log(`🖼️  图片数量: ${windowsImages.length}`);
if (windowsImages.length > 0) {
  console.log(`📁 Windows 路径: ${windowsImages[0]}`);
}
console.log('');

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks[id] = msg => {
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => reject(new Error('CDP timeout')), 60000);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log(`   📸 ${filepath}`);
  } catch (e) {
    console.error(`   ❌ 截图失败: ${e.message}`);
  }
}

async function main() {
  let cdp;

  try {
    // 获取CDP连接
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const toutiaoPage = pagesData.find(p => p.type === 'page' && p.url.includes('toutiao.com'));
    if (!toutiaoPage) {
      throw new Error('未找到今日头条页面，请先在浏览器中打开 mp.toutiao.com');
    }

    cdp = new CDPClient(toutiaoPage.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    console.log('✅ CDP 已连接\n');

    // ========== 步骤1: 导航到微头条发布页 ==========
    console.log('1️⃣  导航到微头条发布页...\n');
    await cdp.send('Page.navigate', { url: 'https://mp.toutiao.com/profile_v4/weitoutiao/publish' });
    await sleep(3000);
    await screenshot(cdp, '01-initial');
    console.log('   ✅ 完成\n');

    // ========== 步骤2: 填写内容 ==========
    console.log('2️⃣  填写内容...\n');

    const escapedContent = content.content
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
        if (editor) {
          editor.focus();
          editor.innerText = '${escapedContent}';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: '未找到编辑器' };
      })()`
    });

    await sleep(2000);
    await screenshot(cdp, '02-content-filled');
    console.log(`   ✅ 已填写 ${content.content.length} 字\n`);

    // ========== 步骤3: 上传图片 ==========
    if (windowsImages.length > 0) {
      console.log(`3️⃣  上传图片（${windowsImages.length} 张）...\n`);

      // 点击图片按钮打开上传 drawer
      console.log('   点击图片按钮...\n');
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          // 使用简化的选择器查找图片按钮
          const selector = '.weitoutiao-image-plugin button';
          const btn = document.querySelector(selector);
          if (btn && btn.offsetWidth > 0) {
            btn.click();
            return { clicked: true, selector };
          }

          // 备用方案：查找包含"图片"文本的可见按钮
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
          const imageBtn = buttons.find(b => {
            const text = b.textContent?.trim();
            return text === '图片' && b.offsetWidth > 0;
          });

          if (imageBtn) {
            imageBtn.click();
            return { clicked: true, selector: 'text-based' };
          }

          return { clicked: false };
        })()`
      });

      await sleep(2000);
      await screenshot(cdp, '03-after-click-image');

      // 查找 file input（drawer 打开后应该出现）
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: 'input[type="file"]'
      });

      console.log(`   找到 ${nodeIds.length} 个 file input\n`);

      if (nodeIds.length > 0) {
        // 上传图片
        console.log('   上传图片文件...\n');
        await cdp.send('DOM.setFileInputFiles', {
          nodeId: nodeIds[0],
          files: windowsImages
        });

        await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            const fileInput = document.querySelectorAll('input[type="file"]')[0];
            if (fileInput) {
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()`
        });

        await sleep(5000);
        await screenshot(cdp, '04-images-uploaded');

        // 验证上传是否成功
        const uploadStatus = await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            const failedText = Array.from(document.querySelectorAll('*')).some(el =>
              el.textContent?.includes('上传失败')
            );
            const uploadedCount = document.querySelectorAll('.upload-list-item').length;
            const uploadingCount = Array.from(document.querySelectorAll('*')).filter(el =>
              el.textContent?.includes('上传中')
            ).length;

            return {
              failed: failedText,
              uploadedCount,
              uploadingCount
            };
          })()`,
          returnByValue: true
        });

        const status = uploadStatus.result.value;
        console.log(`   上传状态: ${JSON.stringify(status)}`);

        if (status.failed) {
          console.log('   ❌ 图片上传失败\n');
          throw new Error('图片上传失败');
        }

        if (status.uploadingCount > 0) {
          console.log('   ⏳ 图片仍在上传中，等待...\n');
          await sleep(5000);
        }

        console.log('   ✅ 图片已上传\n');

        // 关闭上传 drawer（点击确认或关闭按钮）
        console.log('   关闭上传窗口...\n');
        await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(b =>
              (b.textContent.includes('确定') || b.textContent.includes('完成')) &&
              b.offsetWidth > 0 &&
              !b.disabled
            );
            if (confirmBtn) {
              confirmBtn.click();
              return { closed: true };
            }
            return { closed: false };
          })()`
        });

        await sleep(1000);
        await screenshot(cdp, '05-drawer-closed');
      } else {
        console.log('   ❌ 未找到 file input，图片上传失败\n');
      }
    } else {
      console.log('3️⃣  跳过图片上传（无图片）\n');
    }

    // ========== 步骤4: 发布 ==========
    console.log('4️⃣  发布...\n');

    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const publishBtn = buttons.find(b =>
          b.textContent.includes('发布') &&
          b.offsetWidth > 0 &&
          !b.disabled
        );

        if (publishBtn) {
          publishBtn.click();
          return { clicked: true };
        }

        return { clicked: false, error: '未找到发布按钮' };
      })()`
    });

    await sleep(3000);
    await screenshot(cdp, '05-publish-clicked');

    // 检查确认弹窗
    const confirmResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const confirmBtn = buttons.find(b =>
          (b.textContent.includes('确认') || b.textContent.includes('确定')) &&
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

    const confirmValue = confirmResult.result?.value || { confirmed: false };

    if (confirmValue.confirmed) {
      console.log('   ✅ 已确认发布\n');
      await sleep(3000);
      await screenshot(cdp, '06-confirmed');
    }

    console.log('   ✅ 发布完成\n');

    // ========== 步骤5: 验证结果 ==========
    console.log('5️⃣  验证发布结果...\n');

    await sleep(2000);

    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href'
    });

    const currentUrl = result.value;
    console.log(`   当前URL: ${currentUrl}\n`);

    // 检查是否跳转到微头条列表
    if (currentUrl.includes('weitoutiao') && !currentUrl.includes('publish')) {
      console.log('   ✅ 已跳转到微头条列表，发布成功\n');
      await screenshot(cdp, '07-success');

      // 更新状态
      content.status = 'published';
      content.publishedAt = new Date().toISOString();
      content.publishUrl = currentUrl;
      fs.writeFileSync(contentFile, JSON.stringify(content, null, 2));

      console.log('\n========== ✅ 发布成功 ==========\n');
      console.log(`截图目录: ${SCREENSHOTS_DIR}\n`);
      console.log(`状态已更新: ${contentFile}\n`);
      process.exit(0);
    }

    // 检查是否有成功提示
    const hasSuccess = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const body = document.body.textContent;
        return body.includes('发布成功') || body.includes('发表成功');
      })()`
    });

    if (hasSuccess.result.value) {
      console.log('   ✅ 页面显示发布成功\n');
      await screenshot(cdp, '07-success');

      content.status = 'published';
      content.publishedAt = new Date().toISOString();
      fs.writeFileSync(contentFile, JSON.stringify(content, null, 2));

      console.log('\n========== ✅ 发布成功 ==========\n');
      console.log(`截图目录: ${SCREENSHOTS_DIR}\n`);
      process.exit(0);
    }

    console.log('   ⚠️  无法确认发布状态，请手动检查\n');
    await screenshot(cdp, '07-unknown');
    process.exit(0);

  } catch (err) {
    console.error('\n========== ❌ 发布失败 ==========\n');
    console.error(err);
    console.error('\n');

    if (cdp) {
      await screenshot(cdp, 'error-state').catch(() => {});
    }

    process.exit(1);
  } finally {
    if (cdp) {
      cdp.close();
    }
  }
}

main();
