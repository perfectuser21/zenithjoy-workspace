const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19225'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('监听 API 请求...\n');

  const apiRequests = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    
    if (url.includes('/api/feed/mp_provider/v1/')) {
      console.log('捕获 API:', url.substring(0, 100));
      
      try {
        const data = await response.json();
        apiRequests.push({ url, data });
        
        // 统计内容类型
        const stats = {
          total: data.data?.length || 0,
          hasVideo: 0,
          hasImage: 0
        };
        
        data.data?.forEach(item => {
          const elem = item.assembleCell?.itemCell?.containsElements;
          if (elem?.hasVideo) stats.hasVideo++;
          if (elem?.hasImage) stats.hasImage++;
        });
        
        console.log(`  → 总数: ${stats.total}, 视频: ${stats.hasVideo}, 图文: ${stats.hasImage}`);
      } catch (e) {}
    }
  });

  // 导航到内容列表
  console.log('导航到内容列表页面...\n');
  await page.goto('https://mp.toutiao.com/profile_v4/manage/content/all', {
    waitUntil: 'networkidle2'
  });
  
  await page.waitForTimeout(3000);

  // 尝试点击"视频"筛选（如果有）
  console.log('\n查找视频筛选按钮...');
  const clicked = await page.evaluate(() => {
    // 查找包含"视频"的筛选按钮
    const buttons = Array.from(document.querySelectorAll('button, .tab-item, .filter-item'));
    const videoBtn = buttons.find(btn => 
      btn.textContent.includes('视频') || 
      btn.textContent.includes('小视频') ||
      btn.textContent.includes('西瓜视频')
    );
    
    if (videoBtn) {
      videoBtn.click();
      return `点击了: ${videoBtn.textContent}`;
    }
    
    // 查找下拉选择
    const selects = document.querySelectorAll('select, .select-trigger');
    return `未找到视频按钮，页面有 ${buttons.length} 个按钮, ${selects.length} 个下拉`;
  });
  
  console.log(clicked);
  
  await page.waitForTimeout(3000);

  // 保存结果
  if (apiRequests.length > 0) {
    fs.writeFileSync('/tmp/toutiao-video-search.json', JSON.stringify(apiRequests, null, 2));
    console.log(`\n✅ 已保存 ${apiRequests.length} 个 API 请求`);
  }

  await browser.disconnect();

})().catch(console.error);
