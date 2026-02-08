const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });
  
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  
  console.log('📊 正在分析微博数据...\n');
  
  const response = await page.evaluate(async () => {
    const url = window.location.href;
    const uid = url.match(/\/u\/(\d+)/)?.[1] || '7816673011';
    
    try {
      const res = await fetch(`https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=1&feature=0`, {
        credentials: 'include'
      });
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  });
  
  if (response && response.data && response.data.list) {
    const uid = response.data.list[0].user.id;
    
    let allImageCount = 0;
    let allVideoCount = 0;
    let allTextCount = 0;
    let totalPosts = 0;
    
    for (let pageNum = 1; pageNum <= 10; pageNum++) {
      const pageResponse = await page.evaluate(async (p, u) => {
        try {
          const res = await fetch(`https://weibo.com/ajax/statuses/mymblog?uid=${u}&page=${p}&feature=0`, {
            credentials: 'include'
          });
          return await res.json();
        } catch (e) {
          return null;
        }
      }, pageNum, uid);
      
      if (!pageResponse || !pageResponse.data || !pageResponse.data.list || pageResponse.data.list.length === 0) {
        break;
      }
      
      const pagePosts = pageResponse.data.list;
      totalPosts += pagePosts.length;
      
      let pageImage = 0, pageVideo = 0, pageText = 0;
      
      pagePosts.forEach(post => {
        const hasPics = post.pic_num > 0;
        const hasVideo = post.page_info && post.page_info.type === 'video';
        
        if (hasVideo) {
          allVideoCount++;
          pageVideo++;
        } else if (hasPics) {
          allImageCount++;
          pageImage++;
        } else {
          allTextCount++;
          pageText++;
        }
      });
      
      console.log(`第${pageNum}页: ${pagePosts.length}条 (图${pageImage} 视${pageVideo} 文${pageText})`);
      
      await new Promise(r => setTimeout(r, 500));
    }
    
    console.log('\n🎯 全部统计:');
    console.log(`总数: ${totalPosts}条`);
    console.log(`图文(有图): ${allImageCount}条`);
    console.log(`视频: ${allVideoCount}条`);
    console.log(`纯文本: ${allTextCount}条`);
  } else {
    console.log('❌ 无法获取数据');
  }
  
  await browser.disconnect();
})();
