const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });
  
  const pages = await browser.pages();
  const page = pages[1]; // 使用第2个标签页（普通微博）
  
  await page.bringToFront();
  
  const uid = '8429936541';
  console.log('📊 统计账号:', uid);
  console.log('\n【1】普通微博区:');
  
  // 统计普通微博
  let totalWeibo = 0;
  let weiboImage = 0, weiboVideo = 0, weiboText = 0;
  
  for (let pageNum = 1; pageNum <= 10; pageNum++) {
    const response = await page.evaluate(async (p, u) => {
      try {
        const res = await fetch(`https://weibo.com/ajax/statuses/mymblog?uid=${u}&page=${p}&feature=0`, {
          credentials: 'include'
        });
        return await res.json();
      } catch (e) {
        return null;
      }
    }, pageNum, uid);
    
    if (!response || !response.data || !response.data.list || response.data.list.length === 0) {
      break;
    }
    
    const list = response.data.list;
    totalWeibo += list.length;
    
    list.forEach(post => {
      const hasPics = post.pic_num > 0;
      const hasVideo = post.page_info && post.page_info.type === 'video';
      
      if (hasVideo) weiboVideo++;
      else if (hasPics) weiboImage++;
      else weiboText++;
    });
    
    console.log(`  第${pageNum}页: ${list.length}条`);
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`  总计: ${totalWeibo}条 (图${weiboImage} 视${weiboVideo} 文${weiboText})`);
  
  // 统计视频区
  console.log('\n【2】视频专区:');
  
  let allVideos = [];
  let sinceId = '';
  
  for (let i = 0; i < 10; i++) {
    const response = await page.evaluate(async (u, since) => {
      try {
        const url = since 
          ? `https://weibo.com/ajax/profile/getWaterFallContent?uid=${u}&since_id=${since}`
          : `https://weibo.com/ajax/profile/getWaterFallContent?uid=${u}`;
        
        const res = await fetch(url, { credentials: 'include' });
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    }, uid, sinceId);
    
    if (!response || !response.data || !response.data.list || response.data.list.length === 0) {
      break;
    }
    
    const list = response.data.list;
    allVideos = allVideos.concat(list);
    
    if (!response.data.since_id) break;
    sinceId = response.data.since_id;
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  let videoAreaImage = 0, videoAreaVideo = 0;
  allVideos.forEach(item => {
    const hasVideo = item.page_info && item.page_info.type === 'video';
    if (hasVideo) videoAreaVideo++;
    else videoAreaImage++;
  });
  
  console.log(`  总计: ${allVideos.length}条 (图${videoAreaImage} 视${videoAreaVideo})`);
  
  // 汇总
  const totalAll = totalWeibo + allVideos.length;
  const totalImage = weiboImage + videoAreaImage;
  const totalVideo = weiboVideo + videoAreaVideo;
  const totalText = weiboText;
  
  console.log('\n🎯 【汇总】全部内容:');
  console.log(`  总数: ${totalAll}条`);
  console.log(`  图文: ${totalImage}条 (${(totalImage/totalAll*100).toFixed(1)}%)`);
  console.log(`  视频: ${totalVideo}条 (${(totalVideo/totalAll*100).toFixed(1)}%)`);
  console.log(`  纯文本: ${totalText}条 (${(totalText/totalAll*100).toFixed(1)}%)`);
  
  await browser.disconnect();
})();
