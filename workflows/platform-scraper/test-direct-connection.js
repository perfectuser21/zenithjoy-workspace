const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  // 检查浏览器代理设置
  const proxySettings = await page.evaluate(() => {
    return {
      // 检查是否有代理相关的环境变量或设置
      hasProxy: !!(window.navigator.proxy || window.navigator.proxySettings),
      userAgent: window.navigator.userAgent,
      language: window.navigator.language,
      platform: window.navigator.platform
    };
  });
  
  console.log('浏览器环境:');
  console.log(JSON.stringify(proxySettings, null, 2));
  
  // 直接访问腾讯的 IP 检测接口
  await page.goto('https://ip.qq.com', { waitUntil: 'networkidle0', timeout: 30000 });
  
  const qqIpInfo = await page.evaluate(() => document.body.innerText);
  console.log('\n腾讯官方 IP 检测:');
  console.log(qqIpInfo.substring(0, 500));
  
  await browser.disconnect();
  
})().catch(console.error);
