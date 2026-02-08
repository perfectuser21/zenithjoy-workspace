const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log(`当前 URL: ${await page.url()}`);
  
  // 检查是否已登录
  const url = await page.url();
  if (url.includes('login')) {
    console.log('❌ 仍在登录页面，请先登录');
    await browser.disconnect();
    return;
  }
  
  console.log('✅ 已登录！开始分析...\n');
  
  // 捕获 API 响应
  const apiResponses = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    
    // 拦截所有可能包含数据的 API
    if (url.includes('/cgi-bin/') && 
        (url.includes('post') || url.includes('data') || url.includes('stat') || url.includes('performance'))) {
      
      try {
        const status = response.status();
        const contentType = response.headers()['content-type'] || '';
        
        if (contentType.includes('json')) {
          const body = await response.json();
          
          apiResponses.push({
            url,
            status,
            method: response.request().method(),
            body
          });
          
          console.log(`[API] ${response.request().method()} ${url.split('?')[0]} → ${status}`);
        }
      } catch (e) {
        // 忽略解析失败
      }
    }
  });
  
  // 导航到作品列表页
  console.log('\n导航到作品列表页...');
  await page.goto('https://channels.weixin.qq.com/platform/post/list', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });
  
  // 等待数据加载
  await page.waitForTimeout(5000);
  
  // 截图
  await page.screenshot({ path: '/tmp/channels-post-list.png', fullPage: false });
  console.log('截图已保存: /tmp/channels-post-list.png');
  
  // 尝试点击第一个作品查看详情
  console.log('\n尝试点击作品查看详情...');
  const clicked = await page.evaluate(() => {
    // 查找作品卡片（可能的选择器）
    const selectors = [
      '.post-item',
      '.video-item',
      '.content-item',
      '[data-id]',
      'a[href*="post"]',
      'div[role="button"]'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements[0].click();
        return true;
      }
    }
    return false;
  });
  
  if (clicked) {
    console.log('✅ 已点击作品，等待详情加载...');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/channels-detail.png' });
    console.log('详情截图已保存: /tmp/channels-detail.png');
  } else {
    console.log('⚠️ 未找到可点击的作品元素');
  }
  
  // 尝试导航到数据中心
  console.log('\n尝试导航到数据中心...');
  try {
    await page.goto('https://channels.weixin.qq.com/platform/data', { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/channels-data-center.png' });
    console.log('数据中心截图已保存: /tmp/channels-data-center.png');
  } catch (e) {
    console.log('⚠️ 数据中心页面不存在或无权限');
  }
  
  // 返回作品列表
  await page.goto('https://channels.weixin.qq.com/platform/post/list', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });
  
  // 再等待 10 秒捕获更多请求
  console.log('\n等待 10 秒以捕获更多 API 请求...');
  await page.waitForTimeout(10000);
  
  // 保存所有捕获的 API
  console.log(`\n共捕获 ${apiResponses.length} 个 API 响应`);
  
  const fs = require('fs');
  fs.writeFileSync('/tmp/channels-api-full.json', JSON.stringify(apiResponses, null, 2));
  console.log('完整响应已保存: /tmp/channels-api-full.json');
  
  // 分析 post_list API
  const postListAPI = apiResponses.find(r => r.url.includes('post_list'));
  if (postListAPI && postListAPI.body?.data?.list) {
    const list = postListAPI.body.data.list;
    console.log(`\npost_list API 返回 ${list.length} 条作品`);
    
    if (list.length > 0) {
      console.log('\n第一条作品的字段：');
      console.log(JSON.stringify(list[0], null, 2).substring(0, 1000));
      
      // 分析所有字段
      const allFields = new Set();
      list.forEach(item => {
        Object.keys(item).forEach(key => allFields.add(key));
      });
      console.log(`\n所有字段（${allFields.size}个）:`, Array.from(allFields).sort());
    }
  }
  
  await browser.disconnect();
  console.log('\n✅ 分析完成');
  
})().catch(console.error);
