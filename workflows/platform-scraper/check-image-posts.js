const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('当前URL:', await page.url());
  
  // 截图
  await page.screenshot({ path: '/tmp/channels-current-list.png', fullPage: false });
  console.log('截图已保存: /tmp/channels-current-list.png');
  
  // 检查页面上的标签
  const pageInfo = await page.evaluate(() => {
    // 查找标签
    const tabs = [];
    document.querySelectorAll('[role="tab"], .tab, [class*="tab"]').forEach(el => {
      tabs.push(el.innerText?.trim());
    });
    
    // 查找作品数量显示
    const counts = [];
    const text = document.body.innerText;
    const matches = text.match(/视频\s*\((\d+)\)|合集\s*\((\d+)\)|图文\s*\((\d+)\)/g);
    if (matches) {
      matches.forEach(m => counts.push(m));
    }
    
    return {
      tabs: tabs.filter(t => t && t.length < 20),
      counts: counts,
      hasImageTab: text.includes('图文') || text.includes('图片'),
      hasCollectionTab: text.includes('合集')
    };
  });
  
  console.log('\n页面标签信息:');
  console.log(JSON.stringify(pageInfo, null, 2));
  
  // 如果有合集标签，点击看看
  if (pageInfo.hasCollectionTab) {
    console.log('\n发现"合集"标签，尝试点击...');
    const clicked = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const collectionTab = elements.find(el => 
        el.innerText?.trim() === '合集' || 
        el.innerText?.includes('合集')
      );
      if (collectionTab) {
        collectionTab.click();
        return true;
      }
      return false;
    });
    
    if (clicked) {
      console.log('✅ 已点击合集标签');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/channels-collection.png' });
      console.log('合集页截图: /tmp/channels-collection.png');
    }
  }
  
  await browser.disconnect();
  
})().catch(console.error);
