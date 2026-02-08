const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19225'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('开始监听 API 请求...\n');

  // 监听所有请求
  const apiRequests = [];
  page.on('response', async (response) => {
    const url = response.url();

    // 只记录 API 请求（JSON 响应）
    if (url.includes('/api/') || url.includes('.json') || url.includes('mp.toutiao.com')) {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('application/json')) {
        console.log('[API]', response.status(), url.substring(0, 120));

        try {
          const data = await response.json();
          apiRequests.push({ url, data });
        } catch (e) {
          // 忽略 JSON 解析错误
        }
      }
    }
  });

  // 等待当前页面加载完成
  await page.waitForTimeout(2000);

  // 尝试导航到内容管理页面
  const currentUrl = await page.url();
  console.log('\n当前页面:', currentUrl);

  if (!currentUrl.includes('content')) {
    console.log('\n尝试导航到内容管理页面...');
    await page.goto('https://mp.toutiao.com/profile_v4/content/manage', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
  }

  // 等待数据加载
  await page.waitForTimeout(5000);

  // 保存捕获的 API 请求
  if (apiRequests.length > 0) {
    fs.writeFileSync('/tmp/toutiao-api-requests.json', JSON.stringify(apiRequests, null, 2));
    console.log('\n✅ 已保存', apiRequests.length, '个 API 请求到 /tmp/toutiao-api-requests.json');

    // 输出前3个API的URL
    console.log('\nAPI 请求列表（前3个）:');
    apiRequests.slice(0, 3).forEach((req, i) => {
      console.log((i+1) + '.', req.url.substring(0, 100));
    });
  } else {
    console.log('\n⚠️ 未捕获到 API 请求');
  }

  // 截图当前页面
  await page.screenshot({ path: '/tmp/toutiao-content-manage.png', fullPage: true });
  console.log('\n✅ 截图已保存: /tmp/toutiao-content-manage.png');

  await browser.disconnect();

})().catch(console.error);
