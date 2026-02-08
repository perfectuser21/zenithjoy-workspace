const puppeteer = require('puppeteer-core');

(async () => {
  console.log('连接到浏览器...');
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  let page = pages[0];
  
  // 如果没有页面，创建一个
  if (!page) {
    page = await browser.newPage();
  }
  
  console.log('当前URL:', await page.url());
  
  // 导航到 IP 查询页面
  console.log('\n查询公网 IP...');
  await page.goto('https://ifconfig.me', { waitUntil: 'networkidle0', timeout: 30000 });
  
  // 获取 IP
  const ip = await page.evaluate(() => document.body.innerText.trim());
  console.log('公网 IP:', ip);
  
  // 查询更详细的信息
  console.log('\n查询 IP 详细信息...');
  await page.goto('https://ipinfo.io/json', { waitUntil: 'networkidle0', timeout: 30000 });
  
  const ipInfo = await page.evaluate(() => {
    try {
      return JSON.parse(document.body.innerText);
    } catch (e) {
      return document.body.innerText;
    }
  });
  
  console.log('\nIP 详细信息:');
  console.log(JSON.stringify(ipInfo, null, 2));
  
  // 也查一下中文 IP 库
  console.log('\n查询中文 IP 库（ip.cn）...');
  await page.goto('https://ip.cn/api/index?ip=&type=0', { waitUntil: 'networkidle0', timeout: 30000 });
  
  const cnInfo = await page.evaluate(() => {
    try {
      return JSON.parse(document.body.innerText);
    } catch (e) {
      return document.body.innerText;
    }
  });
  
  console.log('\n中文 IP 信息:');
  console.log(JSON.stringify(cnInfo, null, 2));
  
  await browser.disconnect();
  
})().catch(console.error);
