const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19225'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('开始监听网络请求...\n');

  // 存储所有请求
  const allRequests = [];
  
  // 监听所有响应
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    
    // 只显示重要的请求
    if (url.includes('/api/') || url.includes('content') || url.includes('article')) {
      console.log(`[${status}] ${url}`);
    }
    
    // 如果是 JSON 响应，尝试解析
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        allRequests.push({
          url,
          status,
          contentType,
          data
        });
        
        // 如果URL包含content或article，输出提示
        if (url.includes('content') || url.includes('article') || url.includes('list')) {
          console.log('  → ⭐ 可能是内容列表 API');
        }
      } catch (e) {
        // 忽略
      }
    }
  });

  // 导航到内容列表页面（强制刷新）
  console.log('导航到内容列表页面...\n');
  await page.goto('https://mp.toutiao.com/profile_v4/manage/content/all', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // 等待数据加载
  console.log('\n等待数据加载完成...\n');
  await page.waitForTimeout(5000);

  // 保存所有捕获的请求
  if (allRequests.length > 0) {
    fs.writeFileSync('/tmp/toutiao-content-list-requests.json', JSON.stringify(allRequests, null, 2));
    console.log(`\n✅ 已保存 ${allRequests.length} 个 JSON 请求到 /tmp/toutiao-content-list-requests.json\n`);
    
    // 显示所有 API URL
    console.log('JSON API 请求列表:');
    allRequests.forEach((req, i) => {
      const short = req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url;
      console.log(`${i+1}. [${req.status}] ${short}`);
    });
  } else {
    console.log('\n⚠️ 未捕获到任何 JSON 响应');
  }

  // 截图
  await page.screenshot({ path: '/tmp/toutiao-content-list.png', fullPage: true });
  console.log('\n✅ 截图已保存: /tmp/toutiao-content-list.png');

  await browser.disconnect();

})().catch(console.error);
