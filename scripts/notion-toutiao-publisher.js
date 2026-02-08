#!/usr/bin/env node
/**
 * Notion 到今日头条发布脚本（修复版）
 * 从 stdin 读取 JSON 数据：{ title, content, images }
 * 使用正确的发布流程：
 * 1. 填写内容
 * 2. 点击"预览并发布"进入设置
 * 3. 选择"无封面"
 * 4. 点击"预览"
 * 5. 点击"发布"
 */

const WebSocket = require('ws');

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
      setTimeout(() => reject(new Error('CDP timeout')), 30000);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  console.error(`[头条] ${msg}`);
}

async function publishToutiao(cdp, task) {
  const { title, content } = task;

  log('开始发布...');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(500);

  // 填写标题和内容（绕过 React 受控输入）
  log(`填写内容: 标题=${title.substring(0, 20)}...`);

  const fillResult = await cdp.send('Runtime.evaluate', {
    expression: `
      (async function() {
        const results = {};

        // 1. 填写标题（绕过 React）
        const titleInputs = document.querySelectorAll('textarea');
        for (const input of titleInputs) {
          if (input.placeholder && input.placeholder.includes('标题')) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, ${JSON.stringify(title)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            results.title = 'filled';
            break;
          }
        }

        // 等待 React 更新
        await new Promise(r => setTimeout(r, 1000));

        // 2. 填写内容
        const editor = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
        if (editor) {
          editor.innerHTML = '<p>' + ${JSON.stringify(content)}.replace(/\\n/g, '</p><p>') + '</p>';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
          results.content = 'filled';
        }

        return JSON.stringify(results);
      })()
    `,
    awaitPromise: true
  });

  log(`填写结果: ${fillResult.result.value}`);
  await sleep(2000);

  // Step 1: 点击"预览并发布"进入设置页面
  log('点击"预览并发布"进入设置...');
  const clickPreviewPublish = await cdp.send('Runtime.evaluate', {
    expression: `
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('预览并发布') && btn.offsetWidth > 0) {
            btn.click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `
  });

  if (clickPreviewPublish.result.value !== 'clicked') {
    return { success: false, error: '未找到"预览并发布"按钮' };
  }

  // 等待进入设置页面
  await sleep(3000);
  log('已进入设置页面');

  // Step 2: 选择"无封面"
  log('选择"无封面"...');
  const selectNoCover = await cdp.send('Runtime.evaluate', {
    expression: `
      (function() {
        const radios = document.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          const parent = radio.closest('label, div');
          if (parent && parent.textContent.includes('无封面')) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            return 'selected';
          }
        }
        return 'not_found';
      })()
    `
  });
  log(`选择封面: ${selectNoCover.result.value}`);
  await sleep(1500);

  // Step 3: 处理"云端自动同步"弹窗（CRITICAL - 来自commit 5064c1a）
  log('处理云端同步弹窗...');
  const popupResult = await cdp.send('Runtime.evaluate', {
    expression: `
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent.trim();
          if (text.includes('知道了') && !btn.disabled && btn.offsetWidth > 0) {
            btn.click();
            return 'closed: ' + text;
          }
        }
        return 'no_popup';
      })()
    `
  });
  log(`云端同步弹窗: ${popupResult.result.value}`);
  await sleep(500);

  // Step 4: 点击"预览"按钮
  log('点击"预览"按钮...');
  const clickPreview = await cdp.send('Runtime.evaluate', {
    expression: `
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.trim() === '预览' && btn.offsetWidth > 0 && !btn.disabled) {
            btn.click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `
  });

  if (clickPreview.result.value !== 'clicked') {
    return { success: false, error: '未找到"预览"按钮' };
  }

  // 等待预览加载，新的"发布"按钮出现
  await sleep(2500);
  log('预览已打开');

  // Step 5: 点击"发布"按钮（预览后出现的按钮）
  log('点击"发布"按钮...');
  const clickPublish = await cdp.send('Runtime.evaluate', {
    expression: `
      (function() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.trim() === '发布' && btn.offsetWidth > 0 && !btn.disabled) {
            btn.click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `
  });

  if (clickPublish.result.value !== 'clicked') {
    return { success: false, error: '未找到"发布"按钮' };
  }

  log('已点击发布');
  await sleep(2000);

  // 验证发布结果
  log('验证发布结果...');
  await sleep(6000); // 多等待一些时间确保跳转完成

  const finalUrl = await cdp.send('Runtime.evaluate', {
    expression: 'window.location.href'
  });

  const url = finalUrl.result.value;
  log(`当前 URL: ${url}`);

  if (url.includes('/manage') || url.includes('/content/all') || url !== 'https://mp.toutiao.com/profile_v4/graphic/publish') {
    log('✅ 发布成功');
    return { success: true, url };
  } else {
    log('⚠️  未检测到跳转');
    return { success: false, error: '未检测到跳转' };
  }
}

async function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  let task;
  try {
    task = JSON.parse(inputData);
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: 'JSON 解析失败' }));
    process.exit(1);
  }

  const CDP_PORT = 19225;
  const WINDOWS_IP = '100.97.242.124';

  let cdp;
  try {
    const http = require('http');

    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const publishPage = pagesData.find(p =>
      p.type === 'page' && p.url.includes('mp.toutiao.com') && p.url.includes('/publish')
    );

    if (!publishPage) {
      throw new Error('未找到头条发布页面，请确保浏览器已打开发布页面');
    }

    log(`连接页面: ${publishPage.url}`);

    cdp = new CDPClient(publishPage.webSocketDebuggerUrl);
    await cdp.connect();
    log('CDP 已连接');

    const result = await publishToutiao(cdp, task);

    console.log(JSON.stringify(result));

    cdp.close();
    process.exit(result.success ? 0 : 1);

  } catch (e) {
    console.log(JSON.stringify({ success: false, error: e.message }));
    if (cdp) cdp.close();
    process.exit(1);
  }
}

main();
