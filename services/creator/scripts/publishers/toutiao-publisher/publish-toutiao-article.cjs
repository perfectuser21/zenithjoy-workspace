const _log = console.log.bind(console);
#!/usr/bin/env node
/**
 * 今日头条通用发布脚本
 * 支持图文和视频发布
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const CDP_PORT = 19226;
const WINDOWS_IP = '100.97.242.124';

// 从命令行参数读取配置
const args = process.argv.slice(2);
const configFile = args[0] || '/tmp/publish-config.json';

// 读取配置
let config;
try {
  config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
} catch (e) {
  console.error('❌ 无法读取配置文件:', configFile);
  console.error('   请提供 JSON 配置文件');
  process.exit(1);
}

// 配置格式：
// {
//   "type": "image" | "video",
//   "title": "标题",
//   "content": "内容",
//   "media": ["文件路径1", "文件路径2", ...]
// }

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
    const dir = '/tmp/publish-screenshots';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name}.png`, result.data, 'base64');
    _log(`   📸 ${dir}/${name}.png`);
  } catch (e) {}
}

async function publishImage(cdp, config) {
  _log('\n========== 图文发布流程 ==========\n');

  // 1. 进入编辑页面
  _log('1️⃣ 进入编辑页面...\n');
  await cdp.send('Page.navigate', { url: 'https://mp.toutiao.com/profile_v4/graphic/publish' });
  await sleep(5000);
  await screenshot(cdp, 'image-01-edit');

  // 2. 填写标题
  _log('2️⃣ 填写标题...\n');
  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const textarea = document.querySelector('textarea[placeholder*="请输入文章标题"]');
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value').set;
        setter.call(textarea, '${config.title}');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`
  });
  await sleep(1000);
  _log(`   ✅ ${config.title}\n`);

  // 3. 填写内容
  _log('3️⃣ 填写内容...\n');
  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
      if (editor) {
        editor.focus();
        editor.innerHTML = '<p>${config.content}</p>';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`
  });
  await sleep(2000);
  _log(`   ✅ ${config.content.length} 字\n`);

  // 4. 点击"预览并发布"
  _log('4️⃣ 点击"预览并发布"...\n');
  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.textContent.includes('预览并发布') && b.className.includes('primary'));
      if (btn) btn.click();
    })()`
  });
  await sleep(5000);
  await screenshot(cdp, 'image-02-cover');

  // 5. 选择封面类型
  const coverType = config.media.length === 1 ? '单图' : (config.media.length === 3 ? '三图' : '单图');
  _log(`5️⃣ 选择"${coverType}"...\n`);
  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const labels = Array.from(document.querySelectorAll('label'));
      const label = labels.find(l => l.textContent.trim() === '${coverType}');
      if (label) {
        const radio = label.querySelector('input[type="radio"]');
        if (radio) radio.click();
      }
    })()`
  });
  await sleep(2000);

  // 6. 上传图片
  _log('6️⃣ 上传图片...\n');
  
  // 点击"+"打开drawer
  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const addDiv = document.querySelector('.article-cover-add');
      if (addDiv) addDiv.click();
    })()`
  });
  await sleep(2000);

  // 设置文件
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: 'input[type="file"]'
  });

  if (nodeIds.length > 0) {
    await cdp.send('DOM.setFileInputFiles', {
      nodeId: nodeIds[0],
      files: config.media
    });

    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelectorAll('input[type="file"]')[0].dispatchEvent(new Event('change', {bubbles:true}));`
    });

    await sleep(5000);
    _log(`   ✅ ${config.media.length} 张图片已上传\n`);
  }

  await screenshot(cdp, 'image-03-uploaded');

  // 7. 关闭drawer
  await sleep(2000);

  // 8. 配置发布选项
  _log('7️⃣ 配置发布选项...\n');
  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const labels = Array.from(document.querySelectorAll('label'));
      const noAdLabel = labels.find(l => l.textContent.includes('不投放广告'));
      if (noAdLabel) {
        const radio = noAdLabel.querySelector('input[type="radio"]');
        if (radio && !radio.checked) radio.click();
      }
    })()`
  });
  await sleep(1000);

  // 9. 发布
  _log('8️⃣ 点击发布...\n');
  await cdp.send('Runtime.evaluate', {
    expression: `window.scrollTo(0, document.body.scrollHeight);`
  });
  await sleep(1000);

  await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const buttons = Array.from(document.querySelectorAll('button'));
      const publishBtn = buttons.filter(b =>
        b.textContent.includes('发布') &&
        b.className.includes('primary') && 
        b.offsetWidth > 0
      ).pop();
      if (publishBtn) publishBtn.click();
    })()`
  });

  await sleep(3000);

  // 10. 处理确认弹窗
  const modalCheck = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      confirmBtns: Array.from(document.querySelectorAll('button')).filter(b =>
        b.textContent.includes('确认') && b.offsetWidth > 0
      ).length
    })`
  });

  const modalData = JSON.parse(modalCheck.result.value);
  if (modalData.confirmBtns > 0) {
    _log('   处理确认弹窗...\n');
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const confirmBtn = buttons.find(b => b.textContent.includes('确认') && b.offsetWidth > 0);
        if (confirmBtn) confirmBtn.click();
      })()`
    });
    await sleep(3000);
  }

  await sleep(5000);
  await screenshot(cdp, 'image-04-result');

  const finalCheck = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: window.location.href,
      success: window.location.href.includes('/articles')
    })`
  });

  const result = JSON.parse(finalCheck.result.value);
  return result.success;
}

async function publishVideo(cdp, config) {
  _log('\n========== 视频发布流程 ==========\n');
  
  // TODO: 实现视频发布流程
  // 视频发布可能在不同的页面：/profile_v4/xigua/publish
  
  _log('⚠️  视频发布功能开发中...\n');
  _log('提示：今日头条视频发布可能在西瓜视频入口\n');
  
  return false;
}

async function main() {
  let cdp;
  try {
    _log('\n========== 今日头条通用发布 ==========\n');
    _log(`类型: ${config.type === 'image' ? '图文' : '视频'}`);
    _log(`标题: ${config.title}`);
    _log(`媒体文件: ${config.media.length} 个\n`);

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

    _log('✅ 已连接\n');

    let success = false;
    if (config.type === 'image') {
      success = await publishImage(cdp, config);
    } else if (config.type === 'video') {
      success = await publishVideo(cdp, config);
    }

    _log('\n========================================\n');
    if (success) {
      _log('✅✅✅ 发布成功！\n');
    } else {
      _log('⚠️  发布状态待确认\n');
    }

    cdp.close();
    process.exit(success ? 0 : 1);

  } catch (e) {
    console.error('\n❌ 错误:', e.message);
    if (cdp) cdp.close();
    process.exit(1);
  }
}

main();
