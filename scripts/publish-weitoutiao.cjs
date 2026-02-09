#!/usr/bin/env node

/**
 * 今日头条微头条自动发布脚本
 *
 * 功能：
 * 1. 填写内容（ProseMirror编辑器）
 * 2. 上传图片
 * 3. 发布
 *
 * 用法：
 *   node scripts/publish-weitoutiao.cjs <config.json>
 *
 * 配置格式：
 * {
 *   "content": "微头条内容文本",
 *   "images": [
 *     "C:\\path\\to\\image1.jpg",
 *     "C:\\path\\to\\image2.jpg"
 *   ]
 * }
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';
const SCREENSHOTS_DIR = '/tmp/weitoutiao-publish-screenshots';
const WEITOUTIAO_URL = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish';

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

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

class WeitoutiaoPublisher {
  constructor(cdp, config) {
    this.cdp = cdp;
    this.config = config;
  }

  async navigate() {
    console.log('1️⃣  导航到微头条发布页...\n');
    await this.cdp.send('Page.navigate', { url: WEITOUTIAO_URL });
    await sleep(3000);
    await screenshot(this.cdp, '01-initial-page');
    console.log('   ✅ 完成\n');
  }

  async fillContent() {
    console.log('2️⃣  填写内容...\n');

    const content = this.config.content || '';
    if (!content) {
      throw new Error('内容不能为空');
    }

    // 转义内容中的特殊字符
    const escapedContent = content
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    // 填写 ProseMirror 编辑器
    await this.cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
        if (editor) {
          editor.focus();
          // 使用 innerText 保留换行
          editor.innerText = '${escapedContent}';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: '未找到编辑器' };
      })()`
    });

    await sleep(2000);
    await screenshot(this.cdp, '02-content-filled');
    console.log(`   ✅ 已填写 ${content.length} 字\n`);
  }

  async uploadImages() {
    if (!this.config.images || this.config.images.length === 0) {
      console.log('3️⃣  跳过图片上传（无图片）\n');
      return;
    }

    console.log(`3️⃣  上传图片（${this.config.images.length} 张）...\n`);

    // 点击图片上传按钮（在编辑器下方工具栏）
    console.log('   查找图片上传按钮...\n');

    const clickResult = await this.cdp.send('Runtime.evaluate', {
      expression: `(function() {
        // 查找编辑器下方工具栏中的"图片"按钮
        // 微头条的图片按钮通常是一个 div 或 button，包含"图片"文本或图标
        const toolbar = document.querySelector('.ProseMirror')?.closest('div')?.parentElement;
        if (!toolbar) return { success: false, error: '未找到工具栏' };

        // 方法1：查找包含"图片"文本的元素
        const allElements = Array.from(toolbar.querySelectorAll('div, button, span, a'));
        const imageBtn = allElements.find(el => {
          const text = el.textContent?.trim();
          const title = el.getAttribute('title');
          return (text === '图片' || title === '图片') && el.offsetWidth > 0;
        });

        if (imageBtn) {
          imageBtn.click();
          return { success: true, method: 'text' };
        }

        // 方法2：查找图标（SVG 或 icon class）
        const icons = Array.from(toolbar.querySelectorAll('[class*="icon"]'));
        for (const icon of icons) {
          const parent = icon.closest('div, button');
          if (parent && parent.offsetWidth > 0) {
            // 尝试点击可能的图片图标
            const classList = parent.className || '';
            if (classList.includes('image') || classList.includes('picture') || classList.includes('photo')) {
              parent.click();
              return { success: true, method: 'icon' };
            }
          }
        }

        return { success: false, error: '未找到图片按钮' };
      })()`
    });

    const clickValue = clickResult.result?.value || { success: false };

    if (!clickValue.success) {
      console.log(`   ⚠️  ${clickValue.error || '未找到图片上传按钮'}，尝试直接查找 file input...\n`);
    } else {
      console.log(`   ✅ 已点击图片按钮（方式：${clickValue.method}）\n`);
      await sleep(2000);
      await screenshot(this.cdp, '03-upload-clicked');
    }

    // 查找 file input 并上传
    const { root } = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    console.log(`   找到 ${nodeIds.length} 个 file input\n`);

    if (nodeIds.length === 0) {
      throw new Error('未找到 file input，无法上传图片');
    }

    // 使用第一个可见的 file input
    await this.cdp.send('DOM.setFileInputFiles', {
      nodeId: nodeIds[0],
      files: this.config.images
    });

    console.log('   ✅ 文件已设置\n');

    // 触发 change 事件
    await this.cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const fileInput = document.querySelectorAll('input[type="file"]')[0];
        if (fileInput) {
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`
    });

    await sleep(3000);
    await screenshot(this.cdp, '04-images-uploaded');
    console.log('   ✅ 图片已上传\n');
  }

  async publish() {
    console.log('4️⃣  发布...\n');

    // 查找发布按钮
    await this.cdp.send('Runtime.evaluate', {
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
    await screenshot(this.cdp, '05-publish-clicked');

    // 检查是否有确认弹窗
    const confirmResult = await this.cdp.send('Runtime.evaluate', {
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
      await screenshot(this.cdp, '06-confirmed');
    }

    console.log('   ✅ 发布完成\n');
  }

  async verify() {
    console.log('5️⃣  验证发布结果...\n');

    await sleep(2000);

    // 检查当前URL
    const { result } = await this.cdp.send('Runtime.evaluate', {
      expression: 'window.location.href'
    });

    const currentUrl = result.value;
    console.log(`   当前URL: ${currentUrl}\n`);

    // 检查是否跳转到微头条列表页
    if (currentUrl.includes('weitoutiao') && !currentUrl.includes('publish')) {
      console.log('   ✅ 已跳转到微头条列表，发布成功\n');
      await screenshot(this.cdp, '07-success');
      return true;
    }

    // 检查是否有成功提示
    const hasSuccess = await this.cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const body = document.body.textContent;
        return body.includes('发布成功') || body.includes('发表成功');
      })()`
    });

    if (hasSuccess.result.value) {
      console.log('   ✅ 页面显示发布成功\n');
      await screenshot(this.cdp, '07-success');
      return true;
    }

    console.log('   ⚠️  无法确认发布状态，请手动检查\n');
    await screenshot(this.cdp, '07-unknown-state');
    return false;
  }
}

async function main() {
  let cdp;

  try {
    // 读取配置文件
    const configPath = process.argv[2];
    if (!configPath) {
      console.error('用法: node scripts/publish-weitoutiao.cjs <config.json>');
      process.exit(1);
    }

    if (!fs.existsSync(configPath)) {
      console.error(`配置文件不存在: ${configPath}`);
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    console.log('\n========== 微头条自动发布 ==========\n');
    console.log(`内容: ${config.content?.substring(0, 50)}...`);
    console.log(`图片: ${config.images?.length || 0} 张\n`);

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

    // 执行发布流程
    const publisher = new WeitoutiaoPublisher(cdp, config);
    await publisher.navigate();
    await publisher.fillContent();
    await publisher.uploadImages();
    await publisher.publish();
    const success = await publisher.verify();

    if (success) {
      console.log('\n========== ✅ 发布成功 ==========\n');
      console.log(`截图目录: ${SCREENSHOTS_DIR}\n`);
      process.exit(0);
    } else {
      console.log('\n========== ⚠️  发布状态未知 ==========\n');
      console.log(`截图目录: ${SCREENSHOTS_DIR}\n`);
      console.log('请手动检查今日头条后台\n');
      process.exit(0);
    }

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
