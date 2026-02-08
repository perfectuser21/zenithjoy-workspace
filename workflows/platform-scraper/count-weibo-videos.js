const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });
  
  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('📺 统计微博视频区内容...\n');
  
  const uid = await page.evaluate(() => {
    const url = window.location.href;
    return url.match(/\/u\/(\d+)/)?.[1];
  });
  
  console.log('用户 UID:', uid);
  
  // 获取视频瀑布流数据
  let allVideos = [];
  let sinceId = '';
  
  for (let i = 0; i < 10; i++) {
    const response = await page.evaluate(async (uid, since) => {
      try {
        const url = since 
          ? `https://weibo.com/ajax/profile/getWaterFallContent?uid=${uid}&since_id=${since}`
          : `https://weibo.com/ajax/profile/getWaterFallContent?uid=${uid}`;
        
        const res = await fetch(url, { credentials: 'include' });
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    }, uid, sinceId);
    
    if (!response || !response.data || !response.data.list) {
      console.log(`第${i+1}次请求无数据，停止`);
      break;
    }
    
    const list = response.data.list;
    allVideos = allVideos.concat(list);
    
    console.log(`第${i+1}次请求: ${list.length}条`);
    
    if (!response.data.since_id || list.length === 0) {
      break;
    }
    
    sinceId = response.data.since_id;
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n📊 视频区统计:');
  console.log(`总数: ${allVideos.length}条`);
  
  // 分析内容类型
  let videoCount = 0;
  let imageCount = 0;
  
  allVideos.forEach(item => {
    const hasVideo = item.page_info && item.page_info.type === 'video';
    if (hasVideo) {
      videoCount++;
    } else {
      imageCount++;
    }
  });
  
  console.log(`真实视频: ${videoCount}条`);
  console.log(`图文: ${imageCount}条`);
  
  await browser.disconnect();
})();
