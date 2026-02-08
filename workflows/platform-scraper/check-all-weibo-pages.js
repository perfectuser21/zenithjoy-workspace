const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });
  
  const pages = await browser.pages();
  
  console.log(`📱 浏览器打开了 ${pages.length} 个标签页\n`);
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url = await page.url();
    const title = await page.title();
    
    console.log(`标签页 ${i+1}:`);
    console.log(`  标题: ${title}`);
    console.log(`  URL: ${url}`);
    
    const uid = url.match(/\/u\/(\d+)/)?.[1];
    if (uid) {
      console.log(`  UID: ${uid}`);
      
      // 检查是否在视频标签
      const isVideoTab = url.includes('tabtype=newVideo') || url.includes('tabtype=video');
      console.log(`  视频标签: ${isVideoTab ? '是' : '否'}`);
    }
    console.log('');
  }
  
  await browser.disconnect();
})();
