const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('=== 当前网络状态测试 ===\n');
  
  // 访问国内的纯净 IP 检测
  console.log('1. 访问国内 IP 检测（ip.sb）...');
  try {
    await page.goto('https://ip.sb', { 
      waitUntil: 'networkidle0', 
      timeout: 30000 
    });
    
    const ipInfo = await page.evaluate(() => document.body.innerText);
    console.log('IP 信息:');
    console.log(ipInfo.substring(0, 500));
    
  } catch (e) {
    console.log('访问失败:', e.message);
  }
  
  // 再测试一个
  console.log('\n2. 访问 ipip.net...');
  try {
    await page.goto('https://myip.ipip.net', { 
      waitUntil: 'networkidle0', 
      timeout: 30000 
    });
    
    const ipip = await page.evaluate(() => document.body.innerText);
    console.log('IP 信息:');
    console.log(ipip);
    
  } catch (e) {
    console.log('访问失败:', e.message);
  }
  
  await browser.disconnect();
  
})().catch(console.error);
