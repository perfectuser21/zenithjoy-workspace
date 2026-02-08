const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  console.log(`已连接，当前有 ${pages.length} 个标签页`);
  
  let page;
  if (pages.length > 0) {
    page = pages[0];
    console.log(`使用第一个标签页: ${await page.url()}`);
  } else {
    page = await browser.newPage();
    console.log('创建了新标签页');
  }

  // 清除旧请求记录
  const requests = [];
  
  // 拦截所有网络请求
  await page.setRequestInterception(true);
  page.on('request', request => {
    requests.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType()
    });
    request.continue();
  });

  // 记录响应
  const responses = [];
  page.on('response', async response => {
    const url = response.url();
    
    // 只记录 API 请求
    if (url.includes('/cgi-bin/') || 
        url.includes('/api/') || 
        url.includes('channels.weixin.qq.com') && response.request().resourceType() === 'fetch') {
      
      try {
        const status = response.status();
        const headers = response.headers();
        let body = null;
        
        // 只记录 JSON 响应
        if (headers['content-type']?.includes('json')) {
          body = await response.json();
        }
        
        responses.push({
          url,
          status,
          method: response.request().method(),
          body
        });
        
        console.log(`[API] ${response.request().method()} ${url} → ${status}`);
      } catch (e) {
        // 忽略解析失败
      }
    }
  });

  // 导航到创作者后台
  const currentUrl = await page.url();
  if (!currentUrl.includes('channels.weixin.qq.com')) {
    console.log('导航到视频号创作者后台...');
    await page.goto('https://channels.weixin.qq.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  }
  
  console.log(`当前页面: ${await page.url()}`);
  
  // 等待页面加载
  await page.waitForTimeout(3000);
  
  // 截图
  await page.screenshot({ path: '/tmp/channels-page.png', fullPage: false });
  console.log('截图已保存: /tmp/channels-page.png');
  
  // 尝试找到作品管理入口
  console.log('\n查找页面内容...');
  const pageContent = await page.evaluate(() => {
    // 获取所有可见文本
    const texts = [];
    document.querySelectorAll('a, button, div[role="button"], span').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 50 && text.length > 1) {
        texts.push(text);
      }
    });
    return [...new Set(texts)].slice(0, 50);
  });
  
  console.log('页面主要元素文本:', pageContent.slice(0, 20).join(', '));
  
  // 等待更多请求
  console.log('\n等待 10 秒以捕获更多请求...');
  await page.waitForTimeout(10000);
  
  // 输出捕获的 API 请求
  console.log(`\n共捕获 ${responses.length} 个 API 请求:`);
  responses.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.method} ${r.url}`);
    console.log(`    状态: ${r.status}`);
    if (r.body) {
      console.log(`    响应: ${JSON.stringify(r.body).substring(0, 200)}...`);
    }
  });
  
  // 保存完整数据
  const fs = require('fs');
  fs.writeFileSync('/tmp/channels-api-responses.json', JSON.stringify(responses, null, 2));
  console.log('\n完整响应已保存: /tmp/channels-api-responses.json');
  
  // 不关闭浏览器，保持连接
  await browser.disconnect();
  
})().catch(console.error);
