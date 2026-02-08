#!/usr/bin/env node
const puppeteer = require('puppeteer-core');

async function exploreContentAnalysis() {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19223'
  });
  
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  
  console.log('📱 导航到作品分析页...');
  await page.goto('https://cp.kuaishou.com/analysis/creator/content', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  
  await new Promise(r => setTimeout(r, 5000));
  
  // 监听网络请求
  const apiRequests = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/rest/cp/creator/analysis/') && 
        response.request().method() === 'POST') {
      try {
        const data = await response.json();
        apiRequests.push({
          url,
          method: response.request().method(),
          postData: response.request().postData(),
          status: response.status(),
          data
        });
        console.log(`📡 捕获 API: ${url.substring(url.indexOf('/analysis/'))}`);
      } catch (err) {}
    }
  });
  
  // 滚动页面触发加载
  console.log('📜 滚动加载...');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n✅ 捕获了 ${apiRequests.length} 个 API`);
  
  // 分析捕获的 API
  for (const api of apiRequests) {
    console.log(`\n📊 API: ${api.url.substring(api.url.lastIndexOf('/'))}`);
    
    const fields = new Set();
    JSON.stringify(api.data, (key, value) => {
      if (key) fields.add(key);
      return value;
    });
    
    const keywords = ['average', 'completion', 'bounce', 'duration', 'watch', 'retention'];
    const matches = Array.from(fields).filter(f => 
      keywords.some(kw => f.toLowerCase().includes(kw))
    );
    
    if (matches.length > 0) {
      console.log(`   🎯 完播率字段: ${matches.join(', ')}`);
      console.log(`   数据示例: ${JSON.stringify(api.data).substring(0, 300)}`);
    } else {
      console.log(`   字段: ${Array.from(fields).slice(0, 15).join(', ')}`);
    }
  }
  
  await browser.disconnect();
}

exploreContentAnalysis().catch(console.error);
