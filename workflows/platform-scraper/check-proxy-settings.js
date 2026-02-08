const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('=== 检查 Node PC 的代理设置 ===\n');
  
  // 1. 检查 Chrome 的启动参数
  const flags = await page.evaluate(() => {
    return {
      // Chrome 内部状态
      connection: navigator.connection,
      // 检查是否有 Service Worker
      hasServiceWorker: 'serviceWorker' in navigator,
      // 检查是否在省流量模式
      saveData: navigator.connection?.saveData || false
    };
  });
  
  console.log('1. Chrome 状态:');
  console.log(JSON.stringify(flags, null, 2));
  
  // 2. 访问一个纯净的 IP 检测（不经过任何 CDN）
  console.log('\n2. 访问纯净 IP 检测（ipify.org）...');
  await page.goto('https://api.ipify.org?format=json', { 
    waitUntil: 'networkidle0', 
    timeout: 30000 
  });
  
  const ipify = await page.evaluate(() => {
    try {
      return JSON.parse(document.body.innerText);
    } catch (e) {
      return document.body.innerText;
    }
  });
  
  console.log('纯净 IP:', ipify);
  
  // 3. 检查环境变量（通过访问一个显示请求头的服务）
  console.log('\n3. 访问 httpbin.org 查看完整请求头...');
  await page.goto('https://httpbin.org/headers', { 
    waitUntil: 'networkidle0', 
    timeout: 30000 
  });
  
  const headers = await page.evaluate(() => {
    try {
      return JSON.parse(document.body.innerText);
    } catch (e) {
      return document.body.innerText;
    }
  });
  
  console.log('请求头信息:');
  console.log(JSON.stringify(headers, null, 2));
  
  // 检查关键头部
  if (headers.headers) {
    const h = headers.headers;
    console.log('\n=== 关键发现 ===');
    
    if (h['X-Forwarded-For']) {
      console.log('❌ 有代理：X-Forwarded-For =', h['X-Forwarded-For']);
    } else {
      console.log('✅ 无 X-Forwarded-For（直连）');
    }
    
    if (h['Via']) {
      console.log('❌ 有中转：Via =', h['Via']);
    } else {
      console.log('✅ 无 Via（直连）');
    }
    
    if (h['Cf-Ray'] || h['CF-RAY']) {
      console.log('❌ 经过 Cloudflare：CF-Ray =', h['Cf-Ray'] || h['CF-RAY']);
    } else {
      console.log('✅ 未经过 Cloudflare');
    }
  }
  
  await browser.disconnect();
  
})().catch(console.error);
