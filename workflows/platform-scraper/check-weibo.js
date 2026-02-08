const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('当前URL:', await page.url());

  // 全页截图
  await page.screenshot({ 
    path: '/tmp/weibo-current.png', 
    fullPage: true 
  });
  console.log('截图已保存: /tmp/weibo-current.png');

  // 获取页面文本
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('\n页面文本（前800字符）:');
  console.log(pageText.substring(0, 800));

  await browser.disconnect();

})().catch(console.error);
