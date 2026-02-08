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
    
    // 记录所有请求（不限制条件）
    console.log(`[${status}] ${url.substring(0, 100)}`);
    
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
        console.log('  → JSON 已捕获');
      } catch (e) {
        console.log('  → JSON 解析失败');
      }
    }
  });

  // 导航到内容管理页面（强制刷新）
  console.log('\n导航到内容管理页面...\n');
  await page.goto('https://mp.toutiao.com/profile_v4/content/manage', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // 等待数据加载
  console.log('\n等待数据加载完成...\n');
  await page.waitForTimeout(3000);

  // 保存所有捕获的请求
  if (allRequests.length > 0) {
    fs.writeFileSync('/tmp/toutiao-all-requests.json', JSON.stringify(allRequests, null, 2));
    console.log(`\n✅ 已保存 ${allRequests.length} 个请求到 /tmp/toutiao-all-requests.json\n`);
    
    // 显示所有 API URL
    console.log('API 请求列表:');
    allRequests.forEach((req, i) => {
      console.log(`${i+1}. [${req.status}] ${req.url}`);
    });
  } else {
    console.log('\n⚠️ 未捕获到任何 JSON 响应');
  }

  // 截图
  await page.screenshot({ path: '/tmp/toutiao-content-page.png', fullPage: true });
  console.log('\n✅ 截图已保存: /tmp/toutiao-content-page.png');

  await browser.disconnect();

})().catch(console.error);
