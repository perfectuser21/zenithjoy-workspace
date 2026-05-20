const _log = console.log.bind(console);
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\douyin-media';

function scpFileToWindows(localFile, windowsDir) {
  const winDirFwd = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirFwd}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );
  const fname = path.basename(localFile);
  execSync(
    `scp -o StrictHostKeyChecking=no "${localFile}" "${WINDOWS_USER}@${WINDOWS_IP}:${winDirFwd}/${fname}"`,
    { timeout: 180000, stdio: 'pipe' }
  );
  _log(`[DY] ✅ 已传输到 Windows: ${fname}`);
  return path.join(windowsDir, fname).replace(/\//g, '\\');
}

async function publishDouyinArticle(queueFilePath) {
  _log('📝 读取队列文件:', queueFilePath);
  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));

  const title = queueData.title;
  const summary = queueData.summary || queueData.content?.substring(0, 30) || '';
  const content = queueData.content;
  const coverLocal = queueData.cover;

  if (!title) throw new Error('title 为必填项');
  if (!content) throw new Error('content 为必填项');
  if (!coverLocal || !fs.existsSync(coverLocal)) throw new Error('cover 封面图为必填项（无封面会导致发布失败）');

  _log('标题:', title);
  _log('摘要:', summary.substring(0, 30));
  _log('正文:', content.substring(0, 50) + '...');
  _log('封面:', coverLocal);

  // SCP 封面到 Windows
  const batchDir = `${WINDOWS_BASE_DIR}\\${Date.now()}`;
  _log('\n[DY] SCP 封面图到 Windows...');
  const windowsCoverPath = scpFileToWindows(coverLocal, batchDir);
  _log('[DY] Windows 封面路径:', windowsCoverPath);

  _log('\n🔗 连接到现有浏览器（端口 19222）...');
  const browser = await chromium.connectOverCDP('http://localhost:19222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  _log('✅ 已连接到浏览器\n');

  let publishSuccess = false;

  try {
    _log('📍 Step 1: 导航到抖音发布页面');
    await page.goto('https://creator.douyin.com/creator-micro/content/publish-article', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);

    _log('📍 Step 2: 点击"我要发文"');
    const writeBtn = page.locator('text=我要发文').first();
    if (await writeBtn.count() > 0) {
      await writeBtn.click();
      await page.waitForTimeout(2000);
    } else {
      _log('   ⚠️ 未找到"我要发文"按钮，当前页面可能已是编辑页');
    }
    _log('当前 URL:', page.url());

    _log('📍 Step 3: 填写文章标题');
    await page.waitForSelector('input[placeholder*="文章标题"]', { timeout: 15000 });
    await page.fill('input[placeholder*="文章标题"]', title);
    _log('✅ 标题已填写:', title.substring(0, 40));

    _log('📍 Step 4: 填写摘要');
    const summaryInput = page.locator('input[placeholder*="摘要"]').first();
    if (await summaryInput.count() > 0) {
      await summaryInput.fill(summary);
      _log('✅ 摘要已填写');
    } else {
      _log('   ⚠️ 未找到摘要输入框，跳过');
    }

    _log('📍 Step 5: 填写正文');
    const contentFilled = await page.evaluate((text) => {
      const editable = document.querySelector('[contenteditable="true"]');
      if (!editable) return { success: false, error: '未找到 contenteditable 元素' };
      editable.focus();
      editable.innerText = text;
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true };
    }, content);

    if (!contentFilled.success) {
      _log('   降级：用 keyboard.type() 输入正文...');
      const editable = page.locator('[contenteditable="true"]').first();
      await editable.click();
      await page.keyboard.type(content);
    }
    _log('✅ 正文已填写');

    await page.waitForTimeout(1000);

    _log('📍 Step 6: 上传封面头图');
    // 选择"有文章头图"选项
    const hasCoverOption = page.locator('text=有文章头图').first();
    if (await hasCoverOption.count() > 0) {
      await hasCoverOption.click();
      await page.waitForTimeout(1000);
      _log('   ✅ 已选择"有文章头图"');
    }

    // 用 CDP 设置封面文件（跨机器路径，必须用 DOM.setFileInputFiles）
    const cdpSession = await context.newCDPSession(page);
    const fileInputRes = await cdpSession.send('Runtime.evaluate', {
      expression: `document.querySelector('input[type="file"]')`,
    });
    if (!fileInputRes.result.objectId) throw new Error('未找到封面 file input');
    const nodeRes = await cdpSession.send('DOM.describeNode', { objectId: fileInputRes.result.objectId });
    await cdpSession.send('DOM.setFileInputFiles', {
      backendNodeId: nodeRes.node.backendNodeId,
      files: [windowsCoverPath],
    });
    await cdpSession.detach();
    _log('   封面文件已设置，等待上传完成（5秒）...');
    await page.waitForTimeout(5000);

    // 关闭"完成"弹窗（如果出现）
    const doneBtn = page.locator('button:has-text("完成")').first();
    if (await doneBtn.count() > 0) {
      await doneBtn.click();
      _log('   ✅ 已关闭上传完成弹窗');
    }
    await page.waitForTimeout(3000);
    _log('✅ 封面上传完成');

    _log('📍 Step 7: 选择"立即发布"');
    const immediatePublish = page.locator('text=立即发布').first();
    if (await immediatePublish.count() > 0) {
      await immediatePublish.click();
      await page.waitForTimeout(500);
    }

    _log('📍 Step 8: 选择"公开"');
    const publicOption = page.locator('text=公开').first();
    if (await publicOption.count() > 0) {
      await publicOption.click();
      await page.waitForTimeout(500);
    }

    _log('📍 Step 9: 点击发布按钮（XPath）');
    const publishBtn = page.locator(
      'xpath=/html/body/div[1]/div[1]/div/div[3]/div/div/div/div[2]/div/div/div/div/div[1]/div/div[3]/div/div/div/div/div/button[1]'
    );
    await publishBtn.click();
    _log('✅ 已点击发布');

    _log('\n⏳ 等待页面跳转到内容管理（最多15秒）...');
    await page.waitForURL(/\/content\/manage/, { timeout: 15000 }).catch(() => {});
    const finalUrl = page.url();
    _log('最终 URL:', finalUrl);

    if (finalUrl.includes('/content/manage')) {
      publishSuccess = true;
      _log('\n🎉 文章发布成功！已跳转到内容管理页面');
    } else {
      throw new Error(`发布失败，页面未跳转到 /content/manage（当前: ${finalUrl}）`);
    }

  } catch (error) {
    console.error('\n❌ 发布失败:', error.message);
    throw error;
  }
}

const queueFilePath = process.argv[2];
if (!queueFilePath) {
  console.error('用法: node publish-douyin-article.js <queue-file-path>');
  console.error('队列文件格式: { "title": "...", "content": "...", "cover": "/path/to/cover.jpg", "summary": "..." }');
  process.exit(1);
}

publishDouyinArticle(queueFilePath)
  .then(() => {
    _log('\n✅ 全部完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 运行失败:', error.message);
    process.exit(1);
  });
