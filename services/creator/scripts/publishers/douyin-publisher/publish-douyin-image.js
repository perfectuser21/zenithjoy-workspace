const _log = console.log.bind(console);
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\douyin-media';

function scpImagesToWindows(localImages, windowsDir) {
  if (!localImages.length) return [];
  _log(`[DY] SCP ${localImages.length} 张图片到 Windows...`);
  const winDirFwd = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirFwd}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );
  const winPaths = [];
  for (const img of localImages) {
    const fname = path.basename(img);
    execSync(
      `scp -o StrictHostKeyChecking=no "${img}" "${WINDOWS_USER}@${WINDOWS_IP}:${winDirFwd}/${fname}"`,
      { timeout: 180000, stdio: 'pipe' }
    );
    _log(`[DY]    已传输: ${fname}`);
    winPaths.push(path.join(windowsDir, fname).replace(/\//g, '\\'));
  }
  _log(`[DY]    ✅ ${localImages.length} 张图片已到 Windows`);
  return winPaths;
}

async function publishDouyinImage(queueFilePath) {
  _log('📝 读取队列文件:', queueFilePath);

  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));

  _log('标题:', queueData.title || '（自动生成）');
  _log('内容:', queueData.content?.substring(0, 50) + '...');
  _log('图片:', queueData.images?.join(', ') || '（无图片）');

  // SCP 图片到 Windows
  const localImages = (queueData.images || []).filter(f => fs.existsSync(f));
  let windowsImages = [];
  if (localImages.length > 0) {
    const batchDir = `${WINDOWS_BASE_DIR}\\${Date.now()}`;
    windowsImages = scpImagesToWindows(localImages, batchDir);
  }

  _log('\n🔗 连接到现有浏览器...');

  const browser = await chromium.connectOverCDP('http://100.97.242.124:19222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0];

  _log('✅ 已连接到浏览器\n');

  let publishSuccess = false;
  let itemId = null;

  page.on('response', async (res) => {
    const url = res.url();

    if (url.includes('/web/api/media/aweme/create_v2/')) {
      _log('\n[发布 API]', res.status());

      if (res.headers()['content-type']?.includes('application/json')) {
        try {
          const json = await res.json();
          if (json.status_code === 0 && json.item_id) {
            publishSuccess = true;
            itemId = json.item_id;
            _log('✅ 发布成功！作品ID:', itemId);
          }
        } catch (e) {}
      }
    }
  });

  try {
    _log('📍 Step 1: 导航到发布图文页面');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=3', {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(3000);

    _log('📍 Step 2: 上传图片（DOM.setFileInputFiles）');

    if (windowsImages.length > 0) {
      // 使用 DOM.setFileInputFiles 传 Windows 路径（跨机器 CDP 必须用此方式）
      const cdpSession = await context.newCDPSession(page);
      const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: `document.querySelector('input[type="file"]')`,
      });
      if (!result.objectId) throw new Error('未找到 file input');
      const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
      if (!node.backendNodeId) throw new Error('未获取到 file input backendNodeId');
      await cdpSession.send('DOM.setFileInputFiles', {
        backendNodeId: node.backendNodeId,
        files: windowsImages,
      });
      _log(`✅ 已设置 ${windowsImages.length} 张图片（Windows 路径）`);
    } else {
      throw new Error('没有图片文件');
    }

    _log('⏳ 等待图片上传及页面跳转（30秒）');
    // 等待页面从上传页导航到编辑页
    await page.waitForURL(/\/content\/post\/image/, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(5000);
    _log('当前 URL:', page.url());

    _log('📍 Step 3: 填写标题（必填！）');
    const title = queueData.title || `图文作品 ${Date.now()}`;

    // 使用 evaluate 直接操作 DOM（避免 Playwright locator 帧同步问题）
    const titleFilled = await page.evaluate((titleText) => {
      const input = document.querySelector('input[placeholder*="标题"]');
      if (!input) return {success: false, error: '未找到标题 input'};
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, titleText);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      return {success: true, placeholder: input.placeholder};
    }, title);

    if (!titleFilled.success) {
      _log('   ⚠️  标题填写失败:', titleFilled.error, '等待5秒重试...');
      await page.waitForTimeout(5000);
      const titleFilled2 = await page.evaluate((titleText) => {
        const input = document.querySelector('input[placeholder*="标题"]');
        if (!input) return {success: false};
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, titleText);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        return {success: true};
      }, title);
      _log('   重试结果:', JSON.stringify(titleFilled2));
    } else {
      _log('✅ 标题已填写:', title.substring(0, 30));
    }

    _log('📍 Step 4: 填写文案');
    if (queueData.content) {
      const contentFilled = await page.evaluate((contentText) => {
        const editable = document.querySelector('[contenteditable="true"]');
        if (!editable) return {success: false, error: '未找到文案输入框'};
        editable.focus();
        editable.innerText = contentText;
        editable.dispatchEvent(new Event('input', {bubbles: true}));
        return {success: true};
      }, queueData.content);

      if (!contentFilled.success) {
        // 降级：用 keyboard.type
        await page.keyboard.type(queueData.content);
      }
      _log('✅ 文案已填写');
    }

    await page.waitForTimeout(2000);

    _log('\n📍 Step 5: 点击发布按钮');

    const waitForPublish = page.waitForResponse(
      res => res.url().includes('/web/api/media/aweme/create_v2/'),
      { timeout: 30000 }
    ).catch(() => null);

    const publishBtn = page.locator('button:has-text("发布")').last();
    await publishBtn.click();
    _log('✅ 已点击发布');

    _log('\n⏳ 等待发布完成...');
    await page.waitForTimeout(15000);

    const currentUrl = page.url();
    if (currentUrl.includes('/content/manage')) {
      _log('✅ 已跳转到内容管理页面');
      publishSuccess = true;
    }

    if (publishSuccess) {
      _log('\n🎉 图文发布成功！');
      if (itemId) _log('   作品ID:', itemId);
    } else {
      throw new Error('发布失败，页面未跳转到内容管理');
    }

  } catch (error) {
    console.error('\n❌ 发布失败:', error.message);
    throw error;
  }
}

const queueFilePath = process.argv[2];
if (!queueFilePath) {
  console.error('用法: node publish-douyin-image.js <queue-file-path>');
  process.exit(1);
}

publishDouyinImage(queueFilePath)
  .then(() => {
    _log('\n✅ 全部完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 运行失败:', error.message);
    process.exit(1);
  });
