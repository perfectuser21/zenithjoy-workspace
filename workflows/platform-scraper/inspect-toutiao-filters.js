const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19225'
  });

  const pages = await browser.pages();
  const page = pages[0];

  await page.goto('https://mp.toutiao.com/profile_v4/manage/content/all', {
    waitUntil: 'networkidle2'
  });
  
  await page.waitForTimeout(2000);

  // 截图
  await page.screenshot({ 
    path: '/tmp/toutiao-filters-page.png', 
    fullPage: true 
  });
  console.log('✅ 截图: /tmp/toutiao-filters-page.png');

  // 获取页面文本
  const pageText = await page.evaluate(() => {
    // 查找所有可能的筛选元素
    const filters = [];
    
    // 查找标签/按钮
    document.querySelectorAll('button, .tab, .filter, .category').forEach(el => {
      const text = el.textContent.trim();
      if (text && text.length < 50) {
        filters.push(text);
      }
    });
    
    return {
      url: window.location.href,
      filters: [...new Set(filters)].slice(0, 20),
      bodyText: document.body.innerText.substring(0, 1000)
    };
  });

  console.log('\n当前页面:', pageText.url);
  console.log('\n找到的筛选选项:');
  pageText.filters.forEach((f, i) => console.log(`  ${i+1}. ${f}`));
  console.log('\n页面文本（前500字符）:');
  console.log(pageText.bodyText.substring(0, 500));

  await browser.disconnect();

})().catch(console.error);
