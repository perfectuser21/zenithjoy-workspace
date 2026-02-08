const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('当前URL:', await page.url());
  
  // 截图看看页面状态
  await page.screenshot({ path: '/tmp/channels-current.png' });
  console.log('截图已保存: /tmp/channels-current.png');
  
  // 检查页面标题和内容
  const info = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body.innerText.substring(0, 500),
      hasVideoTab: !!document.querySelector('[data-tab="video"]') || document.body.innerText.includes('视频'),
      hasImageTab: !!document.querySelector('[data-tab="image"]') || document.body.innerText.includes('合集') ||document.body.innerText.includes('图文'),
      
      // 尝试查找作品列表元素
      postElements: document.querySelectorAll('[class*="post"], [class*="item"], [class*="card"]').length
    };
  });
  
  console.log('\n页面信息:');
  console.log('标题:', info.title);
  console.log('有视频标签:', info.hasVideoTab);
  console.log('有图文/合集标签:', info.hasImageTab);
  console.log('作品元素数量:', info.postElements);
  console.log('\n页面文本（前500字符）:');
  console.log(info.bodyText);
  
  await browser.disconnect();
  
})().catch(console.error);
