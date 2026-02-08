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
      console.log('✅ 捕获 API');
      
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
        
        console.log(`   内容: 总数=${stats.total}, 视频=${stats.hasVideo}, 图文=${stats.hasImage}\n`);
      } catch (e) {}
    }
  });

  await page.goto('https://mp.toutiao.com/profile_v4/manage/content/all', {
    waitUntil: 'networkidle2'
  });
  
  await page.waitForTimeout(2000);

  // 点击"视频"筛选
  console.log('点击"视频"筛选...\n');
  const clickResult = await page.evaluate(() => {
    // 查找包含"视频"的元素（但不是"微头条"或"小视频"）
    const elements = Array.from(document.querySelectorAll('*'));
    const videoTab = elements.find(el => {
      const text = el.textContent?.trim();
      return text === '视频' || (text?.includes('视频') && !text.includes('微') && !text.includes('小'));
    });
    
    if (videoTab) {
      videoTab.click();
      return `✅ 点击了: ${videoTab.textContent}`;
    }
    
    return '❌ 未找到"视频"选项';
  });
  
  console.log(clickResult);
  
  // 等待 API 响应
  await page.waitForTimeout(3000);

  // 保存结果
  if (apiRequests.length > 0) {
    const lastRequest = apiRequests[apiRequests.length - 1];
    fs.writeFileSync('/tmp/toutiao-video-api.json', JSON.stringify(lastRequest, null, 2));
    console.log(`\n✅ 已保存视频 API 响应到 /tmp/toutiao-video-api.json`);
    
    // 显示第一个视频
    const firstVideo = lastRequest.data.data?.find(item => 
      item.assembleCell?.itemCell?.containsElements?.hasVideo
    );
    
    if (firstVideo) {
      const cell = firstVideo.assembleCell.itemCell;
      console.log('\n找到视频作品！');
      console.log('标题:', cell.articleBase.title.substring(0, 50));
      console.log('指标:', cell.itemCounter);
    } else {
      console.log('\n⚠️ 仍未找到视频作品');
    }
  }

  await browser.disconnect();

})().catch(console.error);
