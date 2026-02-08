const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });
  
  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('📺 检查微博视频区...\n');
  console.log('当前URL:', await page.url());
  
  // 截图当前页面
  await page.screenshot({ path: '/tmp/weibo-current-page.png' });
  console.log('截图已保存: /tmp/weibo-current-page.png\n');
  
  // 检查页面上的导航标签
  const tabs = await page.evaluate(() => {
    const tabElements = document.querySelectorAll('.woo-box-flex.woo-box-alignCenter [role="tab"], .tab-item, a[href*="video"]');
    return Array.from(tabElements).map(el => ({
      text: el.textContent.trim(),
      href: el.href || '',
      className: el.className
    }));
  });
  
  console.log('页面上的标签:');
  tabs.forEach(tab => {
    console.log(`- ${tab.text} ${tab.href ? '(' + tab.href + ')' : ''}`);
  });
  
  // 查找视频标签或视频相关的 API
  console.log('\n检查网络请求...');
  
  // 尝试直接访问视频 API
  const uid = await page.evaluate(() => {
    const url = window.location.href;
    return url.match(/\/u\/(\d+)/)?.[1] || '7816673011';
  });
  
  console.log('用户 UID:', uid);
  
  // 尝试获取视频列表
  const videoResponse = await page.evaluate(async (uid) => {
    try {
      // 尝试不同的视频 API
      const apis = [
        `https://weibo.com/ajax/profile/getWaterFallContent?uid=${uid}`,
        `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&feature=2`, // feature=2 可能是视频
        `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=1&feature=0&video=1`,
      ];
      
      const results = [];
      for (const api of apis) {
        try {
          const res = await fetch(api, { credentials: 'include' });
          const data = await res.json();
          results.push({ api, success: true, hasData: !!data.data });
        } catch (e) {
          results.push({ api, success: false, error: e.message });
        }
      }
      
      return results;
    } catch (e) {
      return { error: e.message };
    }
  }, uid);
  
  console.log('\nAPI 测试结果:');
  videoResponse.forEach(r => {
    console.log(`${r.success ? '✅' : '❌'} ${r.api}`);
    if (r.hasData) console.log('   → 有数据');
  });
  
  await browser.disconnect();
})();
