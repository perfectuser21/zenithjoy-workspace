const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('导航到数据中心...');
  await page.goto('https://channels.weixin.qq.com/platform/data', { 
    waitUntil: 'networkidle0', 
    timeout: 30000 
  });
  
  await page.waitForTimeout(3000);
  
  // 截图
  await page.screenshot({ path: '/tmp/channels-data-page.png' });
  console.log('数据中心截图: /tmp/channels-data-page.png');
  
  // 查找"最近图文"标签
  console.log('\n查找"最近图文"标签...');
  const clicked = await page.evaluate(() => {
    // 查找包含"图文"的元素
    const elements = Array.from(document.querySelectorAll('*'));
    const imageTab = elements.find(el => {
      const text = el.innerText?.trim();
      return text === '最近图文' || text === '图文' || text?.includes('图文');
    });
    
    if (imageTab) {
      console.log('找到图文标签，点击...');
      imageTab.click();
      return true;
    }
    return false;
  });
  
  if (clicked) {
    console.log('✅ 已点击"最近图文"标签');
    await page.waitForTimeout(3000);
    
    // 截图
    await page.screenshot({ path: '/tmp/channels-image-tab.png' });
    console.log('图文标签截图: /tmp/channels-image-tab.png');
    
    // 获取页面文本
    const text = await page.evaluate(() => document.body.innerText);
    console.log('\n页面文本（前500字符）:');
    console.log(text.substring(0, 500));
  } else {
    console.log('❌ 未找到"最近图文"标签');
    
    // 显示页面文本
    const text = await page.evaluate(() => document.body.innerText);
    console.log('\n页面文本:');
    console.log(text.substring(0, 500));
  }
  
  await browser.disconnect();
  
})().catch(console.error);
