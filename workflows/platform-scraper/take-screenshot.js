const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('当前URL:', await page.url());
  
  // 全页截图
  await page.screenshot({ 
    path: '/tmp/channels-full-page.png', 
    fullPage: true 
  });
  console.log('全页截图已保存: /tmp/channels-full-page.png');
  
  // 获取页面文本
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('\n页面文本（前1000字符）:');
  console.log(pageText.substring(0, 1000));
  
  await browser.disconnect();
  
})().catch(console.error);
