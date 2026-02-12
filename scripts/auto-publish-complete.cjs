#!/usr/bin/env node
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';

const localImages = [
  'C:\\automation\\uploads\\f16fac50ddc13a86384e5449ac1ad5e0-test-image-1.jpg',
  'C:\\automation\\uploads\\b7e1e1f5fc5e4aff66f059e6d2585fb4-test-image-2.jpg',
  'C:\\automation\\uploads\\5a06d2917a4038952d840dc649f4bd54-test-image-3.jpg'
];

const testContent = {
  title: '探索人工智能技术在现代社会的应用与发展趋势分析',
  content: '人工智能技术正在深刻改变着我们的生活方式和工作模式。从智能手机上的语音助手，到自动驾驶汽车，再到智能家居系统，人工智能已经渗透到我们日常生活的方方面面。这项技术不仅提高了我们的工作效率，也为我们带来了前所未有的便利体验。随着技术的不断进步，人工智能将在医疗、教育、交通等领域发挥更大的作用，为人类社会的发展带来新的机遇和挑战。'
};

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

  close() { if (this.ws) this.ws.close(); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('/tmp/publish-screenshots', { recursive: true });
    fs.writeFileSync(`/tmp/publish-screenshots/${name}.png`, result.data, 'base64');
    console.log(`   📸 /tmp/publish-screenshots/${name}.png`);
  } catch (e) {}
}

async function main() {
  let cdp;
  try {
    console.log('\n========== 今日头条完整自动发布流程 ==========\n');
    console.log(`标题: ${testContent.title}`);
    console.log(`内容: ${testContent.content.substring(0, 50)}...`);
    console.log(`图片: ${localImages.length} 张\n`);

    const pagesData = await new Promise((resolve, reject) => {
      http.get('http://' + WINDOWS_IP + ':' + CDP_PORT + '/json', res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const toutiaoPage = pagesData.find(p => p.type === 'page' && p.url.includes('toutiao.com'));
    cdp = new CDPClient(toutiaoPage.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    console.log('✅ 已连接\n');

    // ========== 步骤1: 进入编辑页面 ==========
    console.log('1️⃣ 进入编辑页面...\n');
    await cdp.send('Page.navigate', { url: 'https://mp.toutiao.com/profile_v4/graphic/publish' });
    await sleep(5000);
    await screenshot(cdp, '01-edit-page');
    console.log('   ✅ 完成\n');

    // ========== 步骤2: 填写标题 ==========
    console.log('2️⃣ 填写标题...\n');
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const textarea = document.querySelector('textarea[placeholder*="请输入文章标题"]');
        if (textarea) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value').set;
          setter.call(textarea, '${testContent.title}');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`
    });
    await sleep(1000);
    console.log(`   ✅ ${testContent.title}\n`);

    // ========== 步骤3: 填写内容 ==========
    console.log('3️⃣ 填写内容...\n');
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
        if (editor) {
          editor.focus();
          editor.innerHTML = '<p>${testContent.content}</p>';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`
    });
    await sleep(2000);
    console.log(`   ✅ 已填写 ${testContent.content.length} 字\n`);
    await screenshot(cdp, '02-content-filled');

    // ========== 步骤4: 点击"预览并发布" ==========
    console.log('4️⃣ 点击"预览并发布"...\n');
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent.includes('预览并发布') && b.className.includes('primary'));
        if (btn) btn.click();
      })()`
    });
    await sleep(5000);
    await screenshot(cdp, '03-cover-page');
    console.log('   ✅ 已进入封面选择页面\n');

    // ========== 步骤5: 选择"单图" ==========
    console.log('5️⃣ 选择"单图"...\n');
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const labels = Array.from(document.querySelectorAll('label'));
        const singleImageLabel = labels.find(l => l.textContent.trim() === '单图');
        if (singleImageLabel) {
          const radio = singleImageLabel.querySelector('input[type="radio"]');
          if (radio) radio.click();
        }
      })()`
    });
    await sleep(2000);
    await screenshot(cdp, '04-single-selected');
    console.log('   ✅ 已选择\n');

    // ========== 步骤6: 点击"+"打开drawer ==========
    console.log('6️⃣ 点击"+"打开上传drawer...\n');
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const addDiv = document.querySelector('.article-cover-add');
        if (addDiv) {
          addDiv.click();
          return { clicked: true };
        }
        return { clicked: false };
      })()`
    });
    await sleep(2000);
    await screenshot(cdp, '05-drawer-opened');
    console.log('   ✅ Drawer 已打开\n');

    // ========== 步骤7: 上传图片到drawer的file input ==========
    console.log('7️⃣ 上传图片...\n');

    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    console.log(`   找到 ${nodeIds.length} 个 file input\n`);

    if (nodeIds.length > 0) {
      // 使用第一个 input
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: nodeIds[0],
        files: localImages
      });

      console.log(`   ✅ 文件已设置\n`);

      // 触发 change 事件
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const inputs = document.querySelectorAll('input[type="file"]');
          if (inputs[0]) {
            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        })();`
      });

      console.log(`   ✅ change 事件已触发\n`);

      // 等待上传处理
      console.log('   等待上传处理（5秒）...\n');
      await sleep(5000);

      await screenshot(cdp, '06-images-uploaded');

      // 检查上传结果
      const checkResult = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          drawerImages: document.querySelectorAll('.byte-drawer img').length
        })`
      });

      const status = JSON.parse(checkResult.result.value);
      console.log(`   ✅ Drawer 中有 ${status.drawerImages} 张图片\n`);

      if (status.drawerImages === 0) {
        console.log('   ⚠️  警告：未检测到图片，但继续流程\n');
      }

    } else {
      console.log('   ⚠️  未找到 file input，跳过上传\n');
    }

    // ========== 步骤8: 确认图片并关闭drawer（如果需要）==========
    console.log('8️⃣ 确认图片选择...\n');
    
    // 等待一下，让图片完全加载
    await sleep(2000);

    // 尝试关闭drawer或确认选择
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        // 查找"确定"或"完成"按钮
        const buttons = Array.from(document.querySelectorAll('.byte-drawer button'));
        const confirmBtn = buttons.find(b => 
          (b.textContent.includes('确定') || b.textContent.includes('完成')) &&
          b.className.includes('primary')
        );
        
        if (confirmBtn) {
          confirmBtn.click();
          return { closed: true };
        }

        // 或者直接点击遮罩层关闭
        const mask = document.querySelector('.byte-drawer-mask');
        if (mask) {
          mask.click();
          return { closed: true, method: 'mask' };
        }

        return { closed: false };
      })(); JSON.stringify(result);`
    });

    await sleep(2000);
    await screenshot(cdp, '07-drawer-closed');
    console.log('   ✅ 图片已确认\n');

    // ========== 步骤9: 配置发布选项 ==========
    console.log('9️⃣ 配置发布选项...\n');
    
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        // 选择"不投放广告"
        const labels = Array.from(document.querySelectorAll('label'));
        const noAdLabel = labels.find(l => l.textContent.includes('不投放广告'));
        if (noAdLabel) {
          const radio = noAdLabel.querySelector('input[type="radio"]');
          if (radio && !radio.checked) radio.click();
        }
      })()`
    });

    await sleep(1000);
    console.log('   ✅ 已配置\n');

    // 滚动到底部
    await cdp.send('Runtime.evaluate', {
      expression: `window.scrollTo(0, document.body.scrollHeight);`
    });
    await sleep(1000);
    await screenshot(cdp, '08-before-publish');

    // ========== 步骤10: 点击"发布"按钮 ==========
    console.log('🔟 点击"发布"按钮...\n');

    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const publishBtn = buttons.filter(b =>
          (b.textContent.includes('发布') || b.textContent.includes('确定')) &&
          b.className.includes('primary') && 
          b.offsetWidth > 0
        ).pop();
        
        if (publishBtn) {
          publishBtn.click();
          return { clicked: true, text: publishBtn.textContent };
        }
        return { clicked: false };
      })(); JSON.stringify(result);`
    });

    await sleep(3000);
    await screenshot(cdp, '09-after-publish-click');
    console.log('   ✅ 已点击发布\n');

    // ========== 步骤11: 处理确认弹窗（如果有）==========
    console.log('1️⃣1️⃣ 检查确认弹窗...\n');

    await sleep(2000);
    
    const modalCheck = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        confirmBtns: Array.from(document.querySelectorAll('button')).filter(b =>
          b.textContent.includes('确认') && b.offsetWidth > 0
        ).length
      })`
    });

    const modalData = JSON.parse(modalCheck.result.value);
    
    if (modalData.confirmBtns > 0) {
      console.log('   ⚠️  有确认弹窗，点击确认...\n');
      
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const buttons = Array.from(document.querySelectorAll('button'));
          const confirmBtn = buttons.find(b => 
            b.textContent.includes('确认') && b.offsetWidth > 0
          );
          if (confirmBtn) {
            confirmBtn.click();
            return { clicked: true };
          }
          return { clicked: false };
        })()`
      });

      await sleep(3000);
      await screenshot(cdp, '10-after-confirm');
      console.log('   ✅ 已确认\n');
    } else {
      console.log('   ℹ️  无确认弹窗\n');
    }

    // ========== 步骤12: 检查发布结果 ==========
    console.log('1️⃣2️⃣ 检查发布结果...\n');

    await sleep(5000);

    const finalCheck = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        url: window.location.href,
        title: document.title,
        hasSuccess: document.body.textContent.includes('发布成功') || 
                    document.body.textContent.includes('文章已发布'),
        hasError: document.body.textContent.includes('发布失败') || 
                  document.body.textContent.includes('错误')
      })`
    });

    const result = JSON.parse(finalCheck.result.value);
    
    console.log(`   当前 URL: ${result.url}`);
    console.log(`   页面标题: ${result.title}\n`);

    await screenshot(cdp, '11-final-result');

    if (result.hasSuccess) {
      console.log('   ✅✅✅ 发布成功！\n');
    } else if (result.hasError) {
      console.log('   ❌ 发布失败\n');
    } else if (result.url.includes('/articles') || result.url.includes('/content')) {
      console.log('   ✅ 可能成功（已跳转到文章列表）\n');
    } else {
      console.log('   ⚠️  请手动查看发布状态\n');
    }

    console.log('========================================\n');
    console.log('✅ 完整流程执行完成\n');
    console.log('📸 所有截图: /tmp/publish-screenshots/\n');
    console.log('📋 请检查浏览器确认发布结果\n');

    cdp.close();
    process.exit(0);

  } catch (e) {
    console.error('\n❌ 错误:', e.message);
    console.error(e.stack);
    if (cdp) {
      await screenshot(cdp, '99-error');
      cdp.close();
    }
    process.exit(1);
  }
}

main();
