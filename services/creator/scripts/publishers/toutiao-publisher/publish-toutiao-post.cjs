const _log = console.log.bind(console);
#!/usr/bin/env node
/**
 * 今日头条图文发布脚本
 *
 * 功能：
 * 1. 读取内容 JSON 文件
 * 2. 连接到 Windows 浏览器 (CDP)
 * 3. 自动化完成发布流程
 * 4. 更新内容状态
 *
 * 使用：
 * node publish-post.cjs --content /path/to/post.json
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 19226;
const WINDOWS_IP = '100.97.242.124';

// 命令行参数解析
const args = process.argv.slice(2);
const contentFile = args[args.indexOf('--content') + 1];

if (!contentFile || !fs.existsSync(contentFile)) {
  console.error('❌ 错误：必须提供有效的内容文件路径');
  console.error('使用方式：node publish-post.cjs --content /path/to/post.json');
  process.exit(1);
}

// 读取内容
const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));

// 验证内容
if (content.type !== 'post') {
  console.error('❌ 错误：此脚本只能发布图文内容（type: post）');
  process.exit(1);
}

if (!content.title || content.title.length < 2 || content.title.length > 30) {
  console.error(`❌ 错误：标题必须是 2-30 个字符，当前 ${content.title?.length || 0} 个字符`);
  process.exit(1);
}

if (!content.images || content.images.length === 0) {
  console.error('❌ 错误：必须至少提供一张图片');
  process.exit(1);
}

// 转换相对路径为 Windows 绝对路径
const baseDir = 'C:\\Users\\Administrator\\Desktop\\toutiao-media';
const dateDir = path.dirname(contentFile).split('/').pop(); // 提取日期目录
const windowsImages = content.images.map(img => {
  const filename = path.basename(img);
  return path.join(baseDir, dateDir, 'images', filename).replace(/\//g, '\\');
});

_log('\n========================================');
_log('今日头条图文发布');
_log('========================================\n');
_log(`📄 内容 ID: ${content.id}`);
_log(`📝 标题: ${content.title} (${content.title.length} 字符)`);
_log(`🖼️  图片数量: ${windowsImages.length}`);
_log(`📁 Windows 路径: ${windowsImages[0]}`);
_log('');

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
    this.networkRequests = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);

        // 捕获 Network 事件
        if (msg.method === 'Network.requestWillBeSent') {
          this.networkRequests.push({
            requestId: msg.params.requestId,
            url: msg.params.request.url,
            method: msg.params.request.method,
            timestamp: msg.params.timestamp
          });
        }

        if (msg.method === 'Network.responseReceived') {
          const req = this.networkRequests.find(r => r.requestId === msg.params.requestId);
          if (req) {
            req.status = msg.params.response.status;
            req.statusText = msg.params.response.statusText;
          }
        }

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

  getNewRequests(afterTimestamp) {
    return this.networkRequests.filter(r => r.timestamp > afterTimestamp);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function updateContentStatus(status, data = {}) {
  const updatedContent = {
    ...content,
    status,
    ...data,
    logs: [
      ...(content.logs || []),
      `${new Date().toISOString()} - ${status}`
    ]
  };
  fs.writeFileSync(contentFile, JSON.stringify(updatedContent, null, 2));
}

async function main() {
  let cdp;
  try {
    // 连接到浏览器
    _log('1️⃣ 连接到 Windows 浏览器...');
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const toutiaoPage = pagesData.find(p =>
      p.type === 'page' && p.url.includes('toutiao.com')
    );

    if (!toutiaoPage) {
      throw new Error('未找到今日头条页面，请确保浏览器已打开今日头条发布页面');
    }

    cdp = new CDPClient(toutiaoPage.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');

    _log('   ✓ 已连接\n');

    // 检查当前页面
    const currentUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href'
    });
    _log(`   当前页面: ${currentUrl.result.value}\n`);

    // 步骤 1: 填写标题（使用 React 方式）
    _log('2️⃣ 填写标题...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const textarea = document.querySelector('textarea[placeholder*="请输入文章标题"]');
          if (!textarea) return '未找到标题输入框';

          // React 受控组件需要通过 prototype 设置值
          const prototype = Object.getPrototypeOf(textarea);
          const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
          valueSetter.call(textarea, '${content.title}');

          // 触发 React 更新
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          textarea.dispatchEvent(new Event('blur', { bubbles: true }));

          return '标题已填写';
        })()
      `
    });
    await sleep(1000);
    _log(`   ✓ 标题已填写: ${content.title}\n`);

    // 步骤 2: 填写正文（使用 React 方式）
    _log('3️⃣ 填写正文...');
    const contentText = (content.content || '').replace(/\n/g, '</p><p>');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
          if (!editor) return '未找到正文编辑器';

          editor.focus();
          editor.innerHTML = '<p>${contentText}</p>';
          editor.dispatchEvent(new Event('input', { bubbles: true }));

          return '正文已填写';
        })()
      `
    });
    await sleep(1000);
    _log(`   ✓ 正文已填写\n`);

    // 步骤 3: 选择封面类型
    _log('4️⃣ 选择封面类型...');
    const coverTypeMap = {
      'single': '单图',
      'three': '三图',
      'none': '无封面'
    };
    const coverText = coverTypeMap[content.coverType || 'single'];

    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const labels = document.querySelectorAll('label');
          for (const label of labels) {
            if (label.textContent.trim() === '${coverText}') {
              const radio = label.querySelector('input[type="radio"]');
              if (radio) {
                radio.click();
                return '已选择: ${coverText}';
              }
            }
          }
          return '未找到封面选项: ${coverText}';
        })()
      `
    });
    await sleep(1000);
    _log(`   ✓ 已选择 ${coverText}\n`);

    // 滚动到封面选项区域（使上传框可见）
    _log('   滚动到封面区域...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        window.scrollTo(0, document.body.scrollHeight);
      `
    });
    await sleep(1500);
    _log(`   ✓ 滚动完成\n`);

    // 步骤 4: 点击上传框显示文件选择器
    _log('5️⃣ 点击上传框...');
    const clickResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 查找上传区域，优先匹配 className 包含 "cover" 的方框
          const boxes = Array.from(document.querySelectorAll('div')).filter(el => {
            const rect = el.getBoundingClientRect();
            const className = el.className || '';
            // 尺寸限制：宽度 80-400px，高度 80-400px
            return rect.width > 80 && rect.width < 400 &&
                   rect.height > 80 && rect.height < 400 &&
                   rect.top > 100 && rect.top < 900 &&
                   // 优先选择 className 包含 "cover" 或 "upload" 的元素
                   (className.includes('cover') || className.includes('upload') ||
                    // 或者文字很少（可能是上传框）
                    el.textContent.trim().length < 5);
          });

          if (boxes.length === 0) return JSON.stringify({ found: false, boxesCount: 0 });

          // 优先选择精确匹配的 className
          // 1. 最精确：article-cover-images (实际上传区域)
          let box = boxes.find(el => {
            const className = el.className || '';
            return className.includes('article-cover-images') &&
                   !className.includes('wrap') &&
                   !className.includes('container');
          });

          // 2. 退而求其次：包含 "upload" 的
          if (!box) {
            box = boxes.find(el => (el.className || '').includes('upload'));
          }

          // 3. 最后：按面积排序选最小的（上传框通常比较小）
          if (!box) {
            boxes.sort((a, b) => {
              const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
              const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
              return areaA - areaB; // 升序，选最小的
            });
            box = boxes[0];
          }
          const rect = box.getBoundingClientRect();

          // 返回坐标，稍后用 CDP 点击
          return JSON.stringify({
            found: true,
            boxesCount: boxes.length,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            className: box.className || ''
          });
        })()
      `
    });

    const clickData = JSON.parse(clickResult.result.value);
    if (!clickData.found) {
      throw new Error(`未找到上传框 (找到 ${clickData.boxesCount || 0} 个候选框)`);
    }

    _log(`   找到上传框 ${clickData.width}x${clickData.height} at (${clickData.x}, ${clickData.y})`);
    _log(`   className: ${clickData.className}\n`);

    // 使用 CDP 鼠标事件点击（更可靠）
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: clickData.x,
      y: clickData.y,
      button: 'left',
      clickCount: 1
    });

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: clickData.x,
      y: clickData.y,
      button: 'left',
      clickCount: 1
    });

    await sleep(500);
    _log(`   ✓ 已点击上传框\n`);

    // 步骤 5: 上传图片
    _log('6️⃣ 上传图片...');

    // 等待模态框完全加载（需要更长时间）
    _log('   等待上传模态框加载...');
    await sleep(2500);

    // 查找可见的文件输入（在模态框中）
    const {root} = await cdp.send('DOM.getDocument');

    // 先查找所有 file inputs，选择可见的那个
    const inputInfo = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const inputs = Array.from(document.querySelectorAll('input[type="file"][accept*="image"]'));
          for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            if (input.offsetWidth > 0) {
              // 返回可见输入框的索引（从 1 开始，因为 nth-of-type 从 1 开始）
              return JSON.stringify({
                found: true,
                index: i + 1,
                visible: true,
                parentClass: input.parentElement?.className || ''
              });
            }
          }
          // 如果没找到可见的，返回第一个
          return JSON.stringify({
            found: inputs.length > 0,
            index: 1,
            visible: false
          });
        })()
      `
    });

    const inputData = JSON.parse(inputInfo.result.value);
    _log(`   查找结果: found=${inputData.found}, index=${inputData.index}, visible=${inputData.visible}`);

    if (!inputData.found) {
      // 尝试截图以便调试
      const debugScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const fs = require('fs');
      fs.writeFileSync('/tmp/debug-no-input-found.png', debugScreenshot.data, 'base64');
      throw new Error(`未找到文件输入控件 (见截图: /tmp/debug-no-input-found.png)`);
    }

    _log(`   找到文件输入 [索引 ${inputData.index}, ${inputData.visible ? '可见' : '隐藏'}]`);
    if (inputData.parentClass) {
      _log(`   父元素: ${inputData.parentClass.substring(0, 50)}`);
    }

    // 使用正确的索引选择器
    const {nodeId} = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `input[type="file"][accept*="image"]:nth-of-type(${inputData.index})`
    });

    if (!nodeId) {
      throw new Error('无法定位文件输入控件');
    }

    // 设置文件
    await cdp.send('DOM.setFileInputFiles', {
      nodeId,
      files: windowsImages
    });

    _log(`   已设置 ${windowsImages.length} 个文件路径`);

    // 等待文件上传完成（需要更长时间）
    await sleep(5000);

    // 检查上传状态并尝试关闭模态框
    const uploadStatus = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 查找确认/完成按钮来关闭模态框
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if ((text === '完成' || text === '确定' || text === '确认') && btn.offsetWidth > 0) {
              btn.click();
              return JSON.stringify({ closed: true, button: text });
            }
          }

          // 查找关闭按钮（X）
          const closeButtons = Array.from(document.querySelectorAll('[class*="close"], [aria-label*="关闭"]'));
          for (const btn of closeButtons) {
            if (btn.offsetWidth > 0) {
              btn.click();
              return JSON.stringify({ closed: true, button: 'close-icon' });
            }
          }

          return JSON.stringify({ closed: false });
        })()
      `
    });

    const status = JSON.parse(uploadStatus.result.value);
    if (status.closed) {
      _log(`   ✓ 已关闭上传模态框 (${status.button})`);
    } else {
      _log(`   ⚠️  未找到关闭按钮，模态框可能仍打开`);
    }

    await sleep(1000);
    _log(`   ✓ 图片上传流程完成\n`);

    // 步骤 6: 配置选项
    _log('7️⃣ 配置发布选项...');
    const options = content.options || {};

    if (options.adRevenue !== false) {
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            for (const cb of checkboxes) {
              const label = cb.closest('label');
              if (label && label.textContent.includes('广告转收益')) {
                if (!cb.checked) cb.click();
                return '已勾选';
              }
            }
          })()
        `
      });
    }

    if (options.firstPublish !== false) {
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            for (const cb of checkboxes) {
              const label = cb.closest('label');
              if (label && label.textContent.includes('头条首发')) {
                if (!cb.checked) cb.click();
                return '已勾选';
              }
            }
          })()
        `
      });
    }

    if (options.syncMicro !== false) {
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            for (const cb of checkboxes) {
              const label = cb.closest('label');
              if (label && label.textContent.includes('发布同步微头条')) {
                if (!cb.checked) cb.click();
                return '已勾选';
              }
            }
          })()
        `
      });
    }

    await sleep(500);
    _log('   ✓ 选项已配置\n');

    // 步骤 7: 点击"预览并发布"
    _log('8️⃣ 点击"预览并发布"...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('预览并发布')) {
              btn.click();
              return '已点击';
            }
          }
        })()
      `
    });
    await sleep(3000);
    _log('   ✓ 已进入预览页面\n');

    // 步骤 8: 点击"预览"
    _log('9️⃣ 点击"预览"按钮...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.trim() === '预览' && btn.offsetWidth > 0) {
              btn.click();
              return '已点击';
            }
          }
        })()
      `
    });
    await sleep(2000);
    _log('   ✓ 预览窗口已打开\n');

    // 步骤 9: 点击"发布"
    _log('🔟 点击"发布"按钮...');
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.trim() === '发布' && btn.offsetWidth > 0 && !btn.disabled) {
              btn.click();
              return '已点击';
            }
          }
        })()
      `
    });
    await sleep(2000);
    _log('   ✓ 进入确认页面\n');

    // 步骤 10: 点击"确认发布"
    _log('1️⃣1️⃣ 点击"确认发布"按钮...');
    const beforeTimestamp = Date.now() / 1000;

    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('确认发布') && btn.offsetWidth > 0 && !btn.disabled) {
              btn.click();
              return '已点击';
            }
          }
        })()
      `
    });

    // 监控发布请求
    _log('\n   监控发布请求...');
    let foundRequest = false;
    for (let i = 1; i <= 10; i++) {
      await sleep(1000);
      const newRequests = cdp.getNewRequests(beforeTimestamp);
      const keyRequests = newRequests.filter(req =>
        req.url.includes('publish') ||
        req.url.includes('article') ||
        req.url.includes('submit')
      );
      if (keyRequests.length > 0 && !foundRequest) {
        _log(`   ✓ 第 ${i} 秒：检测到发布请求`);
        foundRequest = true;
        break;
      } else if (!foundRequest) {
        process.stdout.write(`   等待... ${i}s\r`);
      }
    }

    await sleep(3000);

    // 检查最终状态
    const finalUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href'
    });

    const finalUrlValue = finalUrl.result.value;
    _log(`\n   最终 URL: ${finalUrlValue}\n`);

    // 截图
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const screenshotDir = `/tmp/toutiao-screenshots/${dateDir}`;
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(screenshotDir, `${content.id}-final.png`);
    fs.writeFileSync(screenshotPath, screenshot.data, 'base64');
    _log(`📸 截图已保存: ${screenshotPath}\n`);

    // 判断成功
    if (finalUrlValue.includes('/manage') || finalUrlValue.includes('/articles')) {
      _log('========================================');
      _log('🎉 发布成功！');
      _log('========================================\n');

      updateContentStatus('published', {
        publishedAt: new Date().toISOString(),
        publishUrl: finalUrlValue
      });

      cdp.close();
      process.exit(0);
    } else {
      throw new Error('页面未跳转到预期位置，发布可能失败');
    }

  } catch (e) {
    console.error('\n========================================');
    console.error('❌ 发布失败');
    console.error('========================================');
    console.error(`错误: ${e.message}\n`);

    updateContentStatus('publish_failed', {
      error: e.message,
      failedAt: new Date().toISOString()
    });

    if (cdp) cdp.close();
    process.exit(1);
  }
}

main();
